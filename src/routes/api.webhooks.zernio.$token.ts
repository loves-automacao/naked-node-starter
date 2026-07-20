// Webhook público e exclusivo por usuário.
// A Zernio envia POST para /api/webhooks/zernio/$token onde $token é o webhook_token do profile.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptString } from "@/server/crypto.server";
import {
  zernioSendPrivateReply,
  zernioFindConversationId,
  zernioSendConversationMessage,
} from "@/server/zernio.server";
import { createStepLogger, parseZernioError, type StepLogger } from "@/lib/step-logger.server";
import { getWebhookEventId, isWebhookBodyTooLarge, matchedKeyword } from "@/lib/webhook-rules";
import { fetchWithTimeout } from "@/server/http.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Signature",
};

const sleep = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs));

interface ZernioCommentEvent {
  id?: string;
  event?: string;
  comment?: {
    id?: string;
    platformPostId?: string;
    platform?: string;
    text?: string;
    author?: { id?: string; username?: string };
  };
  post?: { platformPostId?: string };
  account?: { id?: string; platform?: string; username?: string };
  timestamp?: string;
}

interface ZernioMessageEvent {
  id?: string;
  event?: string;
  message?: {
    id?: string;
    conversationId?: string;
    text?: string;
    quickReply?: { payload?: string };
    sender?: {
      id?: string;
      username?: string;
      instagramProfile?: { isFollower?: boolean | null };
    };
  };
  account?: { id?: string; username?: string };
  timestamp?: string;
}

function friendlyZernioError(raw: string): string {
  if (raw.includes("INBOX_REQUIRED")) {
    return "Sua conta Zernio não tem o addon Inbox ativo. Ative-o em zernio.com (Configurações → Addons).";
  }
  if (raw.includes("timeout")) {
    return `Zernio demorou para responder: ${raw}`;
  }
  return raw;
}

export const Route = createFileRoute("/api/webhooks/zernio/$token")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const challenge = url.searchParams.get("hub.challenge");
        if (challenge) return new Response(challenge, { status: 200, headers: corsHeaders });
        return new Response("ok", { status: 200, headers: corsHeaders });
      },
      POST: async ({ request, params }) => {
        try {
          return await handleWebhookPost({ request, params });
        } catch (e) {
          console.error("[webhook] uncaught error:", e);
          return new Response(JSON.stringify({ ok: false, error: "internal" }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }
      },
    },
  },
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

type LogPatch = {
  status?: string;
  error?: string | null;
  message_sent?: string | null;
  automation_id?: string | null;
  comment_text?: string | null;
  instagram_user?: string | null;
  instagram_post_id?: string | null;
  event_type?: string | null;
  trigger_keyword?: string | null;
};

async function updateLog(logId: string | null, patch: LogPatch): Promise<void> {
  if (!logId) return;
  const { error } = await supabaseAdmin
    .from("automation_logs")
    .update(patch as never)
    .eq("id", logId);
  if (error) console.error("[webhook] updateLog failed:", error.message);
}

async function incrementAutomationCounter(
  automationId: string,
  counter: "failed" | "sent",
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("increment_automation_counter", {
    p_automation_id: automationId,
    p_counter: counter,
  });
  if (error) console.error("[webhook] incrementAutomationCounter failed:", error.message);
}

async function finish(
  logger: StepLogger,
  logId: string | null,
  opts: {
    status: "sent" | "failed" | "skipped";
    stoppedAtStep?: string | null;
    error?: string | null;
    responseBody: Record<string, unknown>;
  },
): Promise<Response> {
  const totalDurationMs = Date.now() - logger.startedAt;
  await Promise.all([
    logger.finalize({ stoppedAtStep: opts.stoppedAtStep ?? null, totalDurationMs }),
    updateLog(logId, { status: opts.status, error: opts.error ?? null }),
    logger.info(
      "automation_finished",
      opts.status === "sent"
        ? "Automação concluída com sucesso"
        : opts.status === "failed"
          ? `Automação encerrada em: ${opts.stoppedAtStep ?? "erro"}`
          : `Automação ignorada (${opts.stoppedAtStep ?? "sem ação"})`,
      { total_duration_ms: totalDurationMs, final_status: opts.status },
    ),
  ]);
  return jsonResponse({ ok: true, ...opts.responseBody, duration_ms: totalDurationMs });
}

async function handleWebhookPost({
  request,
  params,
}: {
  request: Request;
  params: { token: string };
}): Promise<Response> {
  const token = params.token;
  if (!token || token.length < 16) {
    return jsonResponse({ error: "invalid token" }, 401);
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("webhook_token", token)
    .maybeSingle();

  if (!profile) return jsonResponse({ error: "unknown token" }, 404);
  const userId = profile.id;

  if (isWebhookBodyTooLarge(request.headers.get("content-length"))) {
    return jsonResponse({ error: "payload_too_large" }, 413);
  }

  let rawBodyText = "";
  let rawPayload: ZernioCommentEvent & ZernioMessageEvent = {};
  try {
    rawBodyText = await request.text();
    if (isWebhookBodyTooLarge(null, rawBodyText)) {
      return jsonResponse({ error: "payload_too_large" }, 413);
    }
    if (rawBodyText) {
      rawPayload = JSON.parse(rawBodyText) as ZernioCommentEvent & ZernioMessageEvent;
    }
  } catch {
    await supabaseAdmin.from("automation_logs").insert({
      user_id: userId,
      status: "received",
      error: `invalid_json: ${rawBodyText.slice(0, 200)}`,
    } as never);
    return jsonResponse({ error: "invalid json" }, 400);
  }

  const eventType = rawPayload.event ?? "unknown";
  const externalEventId = getWebhookEventId(eventType, rawPayload)?.slice(0, 500) ?? null;

  const { data: logRow, error: logError } = await supabaseAdmin
    .from("automation_logs")
    .insert({
      user_id: userId,
      status: "received",
      comment_text: rawPayload.comment?.text ?? rawPayload.message?.text ?? null,
      instagram_user:
        rawPayload.comment?.author?.username ?? rawPayload.message?.sender?.username ?? null,
      instagram_post_id:
        rawPayload.comment?.platformPostId ?? rawPayload.post?.platformPostId ?? null,
      event_type: eventType,
      external_event_id: externalEventId,
    })
    .select("id")
    .maybeSingle();

  if (logError?.code === "23505" && externalEventId) {
    return jsonResponse({ ok: true, duplicate: true, event_id: externalEventId });
  }
  if (logError) {
    console.error("[webhook] failed to reserve event:", logError.message);
    return jsonResponse({ ok: false, error: "event_reservation_failed" }, 503);
  }

  const logId = (logRow?.id as string | undefined) ?? null;
  const logger = createStepLogger(logId, userId);

  await logger.info("webhook_received", `Webhook recebido (${eventType})`, {
    event: eventType,
    from: rawPayload.comment?.author?.username ?? rawPayload.message?.sender?.username ?? null,
  });

  // ── message.received ──
  if (eventType === "message.received" && rawPayload.message) {
    return handleMessageEvent({ userId, rawPayload, logger, logId });
  }

  // ── comment.received ──
  if (eventType !== "comment.received" || !rawPayload.comment) {
    return finish(logger, logId, {
      status: "skipped",
      stoppedAtStep: "unsupported_event",
      error: `Evento ignorado: ${eventType}`,
      responseBody: { ignored: eventType },
    });
  }

  return handleCommentEvent({ userId, rawPayload, logger, logId, externalEventId });
}

async function handleMessageEvent({
  userId,
  rawPayload,
  logger,
  logId,
}: {
  userId: string;
  rawPayload: ZernioMessageEvent & ZernioCommentEvent;
  logger: StepLogger;
  logId: string | null;
}): Promise<Response> {
  const msg = rawPayload.message!;
  const senderId = msg.sender?.id;
  const senderUsername = msg.sender?.username;
  const payloadFromClick = msg.quickReply?.payload;
  const conversationId = msg.conversationId;
  // isFollower disponível em msg.sender?.instagramProfile?.isFollower — não usado no fluxo global.

  const validate = await logger.step("validate_message", "Validando mensagem recebida", {
    has_sender: !!senderId,
    has_conversation: !!conversationId,
  });
  if (!senderId || !conversationId) {
    await validate.skip("Mensagem incompleta (sem sender ou conversationId)");
    return finish(logger, logId, {
      status: "skipped",
      stoppedAtStep: "validate_message",
      error: "incomplete_message",
      responseBody: { ignored: "incomplete_message" },
    });
  }
  if (rawPayload.account?.username && senderUsername === rawPayload.account.username) {
    await validate.skip("Mensagem enviada pela própria conta (self)");
    return finish(logger, logId, {
      status: "skipped",
      stoppedAtStep: "validate_message",
      error: "self_message",
      responseBody: { ignored: "self_message" },
    });
  }
  await validate.success();

  const loadSettings = await logger.step("load_settings", "Carregando credenciais da conta");
  const { data: settings } = await supabaseAdmin
    .from("user_settings")
    .select("zernio_api_key_encrypted,zernio_account_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!settings?.zernio_api_key_encrypted || !settings?.zernio_account_id) {
    await loadSettings.fail(new Error("API Key ou accountId ausentes"));
    return finish(logger, logId, {
      status: "failed",
      stoppedAtStep: "load_settings",
      error: "no_api_key_or_account",
      responseBody: { skipped: "no_api_key" },
    });
  }
  await loadSettings.success();

  let apiKey: string;
  try {
    apiKey = decryptString(settings.zernio_api_key_encrypted);
  } catch (e) {
    const em = e instanceof Error ? e.message : String(e);
    const dec = await logger.step("decrypt_api_key", "Descriptografando API Key");
    await dec.fail(e);
    return finish(logger, logId, {
      status: "failed",
      stoppedAtStep: "decrypt_api_key",
      error: `decrypt_failed: ${em}. Salve a API Key novamente.`,
      responseBody: { error: "decrypt_failed" },
    });
  }

  // Nota: `isFollower` fica disponível no payload mas não bloqueia mais o fluxo.
  // Regras de "somente seguidores" devem ser opt-in por automação, não globais.

  if (payloadFromClick) {
    const findAuto = await logger.step(
      "find_automation",
      "Buscando automação para entregar conteúdo",
      {
        quick_reply_payload: payloadFromClick,
      },
    );
    const { data: autos } = await supabaseAdmin
      .from("automations")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1);
    const matching = autos?.[0];
    await findAuto.success({ extraContext: { automation_id: matching?.id ?? null } });

    const contentMessage =
      matching?.followup_message || matching?.custom_message || "Aqui está o conteúdo! 🎉";
    const deliver = await logger.step("content_delivery", "Enviando conteúdo (resposta ao clique)");
    try {
      const res = await zernioSendConversationMessage({
        apiKey,
        accountId: settings.zernio_account_id,
        conversationId,
        message: contentMessage,
      });
      await deliver.success({ apiResponse: res });
      await updateLog(logId, {
        message_sent: contentMessage,
        automation_id: matching?.id ?? null,
      });
      return finish(logger, logId, {
        status: "sent",
        responseBody: { action: "content_delivered" },
      });
    } catch (e) {
      const p = await deliver.fail(e);
      return finish(logger, logId, {
        status: "failed",
        stoppedAtStep: "content_delivery",
        error: friendlyZernioError(p.message),
        responseBody: { action: "delivery_failed" },
      });
    }
  }

  // DM direta sem quick reply → procura automação com trigger_on_dm
  const messageText = msg.text || "";
  const findDm = await logger.step("find_dm_trigger", "Procurando automação de DM direta", {
    message: messageText.slice(0, 120),
  });
  const { data: dmAutos } = await supabaseAdmin
    .from("automations")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .eq("trigger_on_dm", true)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  let matchedKw: string | null = null;
  const matchingDm = (dmAutos ?? []).find((a) => {
    if (!a.keyword_filter_enabled) return true;
    const kw = matchedKeyword(messageText, a.keywords ?? []);
    if (kw) {
      matchedKw = kw;
      return true;
    }
    return false;
  });

  if (!matchingDm) {
    await findDm.skip("Nenhuma automação de DM ativa casou com essa mensagem");
    return finish(logger, logId, {
      status: "skipped",
      stoppedAtStep: "find_dm_trigger",
      error: "no_dm_trigger_match",
      responseBody: { ignored: "no_dm_trigger_match" },
    });
  }
  await findDm.success({
    extraContext: { automation_id: matchingDm.id, matched_keyword: matchedKw },
  });
  if (matchedKw) await updateLog(logId, { trigger_keyword: matchedKw });

  const dmMessage = matchingDm.followup_message || matchingDm.custom_message;
  const dmQuickReplies = (matchingDm.quick_replies as { title: string; payload: string }[]) ?? [];
  const dmButtons =
    (matchingDm.buttons as { type: string; title: string; payload?: string; url?: string }[]) ?? [];

  const send = await logger.step("dm_trigger_send", "Enviando resposta automática à DM", {
    quick_replies: dmQuickReplies.length,
    buttons: dmButtons.length,
  });
  try {
    const res = await zernioSendConversationMessage({
      apiKey,
      accountId: settings.zernio_account_id,
      conversationId,
      message: dmMessage,
      quickReplies: dmQuickReplies.length > 0 ? dmQuickReplies : undefined,
      buttons: dmButtons.length > 0 ? dmButtons : undefined,
    });
    await send.success({ apiResponse: res });
    await updateLog(logId, { automation_id: matchingDm.id, message_sent: dmMessage });
    await incrementAutomationCounter(matchingDm.id, "sent");
    return finish(logger, logId, {
      status: "sent",
      responseBody: { action: "dm_trigger_sent" },
    });
  } catch (e) {
    const p = await send.fail(e);
    await updateLog(logId, { automation_id: matchingDm.id });
    return finish(logger, logId, {
      status: "failed",
      stoppedAtStep: "dm_trigger_send",
      error: friendlyZernioError(p.message),
      responseBody: { action: "dm_trigger_failed" },
    });
  }
}

async function handleCommentEvent({
  userId,
  rawPayload,
  logger,
  logId,
  externalEventId,
}: {
  userId: string;
  rawPayload: ZernioCommentEvent;
  logger: StepLogger;
  logId: string | null;
  externalEventId: string | null;
}): Promise<Response> {
  const pc = rawPayload.comment!;
  const comment = {
    commentId: pc.id,
    text: pc.text || "",
    fromId: pc.author?.id,
    fromUsername: pc.author?.username,
    postId: pc.platformPostId || rawPayload.post?.platformPostId,
  };

  const validate = await logger.step("validate_comment", "Validando comentário recebido", {
    from: comment.fromUsername,
    post: comment.postId,
    text: comment.text.slice(0, 120),
  });
  if (!comment.commentId || !comment.fromId || !comment.postId) {
    await validate.skip("Comentário incompleto (sem id, autor ou post)");
    return finish(logger, logId, {
      status: "skipped",
      stoppedAtStep: "validate_comment",
      error: "incomplete_comment",
      responseBody: { ignored: "incomplete_comment" },
    });
  }
  await validate.success();

  const commentId = comment.commentId;
  const fromId = comment.fromId;
  const postId = comment.postId;

  const loadSettings = await logger.step("load_settings", "Carregando credenciais e automações");
  const [{ data: settings }, { data: autos }] = await Promise.all([
    supabaseAdmin
      .from("user_settings")
      .select(
        "zernio_api_key_encrypted,zernio_account_id,outgoing_webhook_url,outgoing_webhook_enabled",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("automations")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }),
  ]);

  if (!settings?.zernio_api_key_encrypted || !settings?.zernio_account_id) {
    await loadSettings.fail(new Error("API Key ou accountId ausentes"));
    return finish(logger, logId, {
      status: "failed",
      stoppedAtStep: "load_settings",
      error: "no_api_key_or_account",
      responseBody: { skipped: "no_api_key_or_account" },
    });
  }
  await loadSettings.success({ extraContext: { automations_active: (autos ?? []).length } });

  const matchStep = await logger.step("match_automation", "Buscando automação compatível", {
    post_id: postId,
    comment_text: comment.text,
  });
  let matchedKw: string | null = null;
  const matching = (autos ?? []).find((a) => {
    const stored = a.instagram_post_id;
    if (stored !== "*" && stored !== postId) return false;
    if (a.keyword_filter_enabled) {
      const kw = matchedKeyword(comment.text, a.keywords ?? []);
      if (!kw) return false;
      matchedKw = kw;
      return true;
    }
    return true;
  });

  if (!matching) {
    await matchStep.skip("Nenhuma automação compatível (post ou palavra-chave não casou)");
    return finish(logger, logId, {
      status: "skipped",
      stoppedAtStep: "match_automation",
      error: "Nenhuma automação compatível (post/keyword)",
      responseBody: { skipped: "no_match" },
    });
  }
  await matchStep.success({
    extraContext: {
      automation_id: matching.id,
      automation_name: matching.name,
      matched_keyword: matchedKw,
    },
  });
  if (matchedKw) {
    await logger.info("keyword_matched", `Palavra-chave "${matchedKw}" encontrada`, {
      keyword: matchedKw,
    });
    await updateLog(logId, { trigger_keyword: matchedKw });
  }
  await updateLog(logId, { automation_id: matching.id });

  let apiKey: string;
  try {
    apiKey = decryptString(settings.zernio_api_key_encrypted);
  } catch (e) {
    const dec = await logger.step("decrypt_api_key", "Descriptografando API Key");
    const p = await dec.fail(e);
    return finish(logger, logId, {
      status: "failed",
      stoppedAtStep: "decrypt_api_key",
      error: `decrypt_failed: ${p.message}. Salve a API Key novamente.`,
      responseBody: { error: "decrypt_failed" },
    });
  }

  const accountId = settings.zernio_account_id;

  const parseJsonbArray = <T>(raw: unknown): T[] => {
    if (Array.isArray(raw)) return raw as T[];
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  const quickReplies = parseJsonbArray<{ title: string; payload: string }>(matching.quick_replies);
  const buttons = parseJsonbArray<{
    type: string;
    title: string;
    payload?: string;
    url?: string;
  }>(matching.buttons);
  const hasFollowup = !!matching.followup_message || quickReplies.length > 0 || buttons.length > 0;

  // ── 1ª mensagem: private reply ──
  let primarySent = false;
  let stoppedAt: string | null = null;
  let finalErr: string | null = null;

  if (matching.custom_message) {
    const s = await logger.step("private_reply", "Enviando primeira DM (private reply)", {
      comment_id: commentId,
      post_id: postId,
      preview: matching.custom_message.slice(0, 80),
    });
    try {
      const res = await zernioSendPrivateReply({
        apiKey,
        accountId,
        postId,
        commentId,
        message: matching.custom_message,
      });
      await s.success({ apiResponse: res });
      primarySent = true;
    } catch (e) {
      const p = await s.fail(e);
      stoppedAt = "private_reply";
      finalErr = friendlyZernioError(p.message);
    }
  } else {
    primarySent = true;
    await logger.info("private_reply_skipped", "Primeira DM não configurada — pulando");
  }

  // ── follow-up ──
  let followupSent = false;
  if (primarySent && hasFollowup) {
    const findConv = await logger.step("find_conversation", "Localizando conversa com o usuário", {
      participant: fromId,
    });
    let conversationId: string | null = null;
    try {
      conversationId = await zernioFindConversationId({
        apiKey,
        accountId,
        participantId: fromId,
      });
      if (!conversationId) {
        // 2ª tentativa
        await findConv.skip("Conversa ainda não indexada — tentando novamente");
        await sleep(1_000);
        const retry = await logger.step(
          "find_conversation_retry",
          "Retentando localizar a conversa",
        );
        try {
          conversationId = await zernioFindConversationId({
            apiKey,
            accountId,
            participantId: fromId,
          });
          if (conversationId) {
            await retry.success({ extraContext: { conversation_id: conversationId } });
          } else {
            await retry.fail(new Error("Conversation not found after retry"));
            stoppedAt = "find_conversation";
            finalErr = "Conversation not found — Instagram ainda não abriu a janela de 24h";
          }
        } catch (e) {
          const p = await retry.fail(e);
          stoppedAt = "find_conversation";
          finalErr = friendlyZernioError(p.message);
        }
      } else {
        await findConv.success({ extraContext: { conversation_id: conversationId } });
      }
    } catch (e) {
      const p = await findConv.fail(e);
      stoppedAt = "find_conversation";
      finalErr = friendlyZernioError(p.message);
    }

    if (conversationId && !stoppedAt) {
      // O private reply abre a conversa de forma assíncrona no Instagram.
      // Esta janela evita que o follow-up concorra com a primeira resposta.
      await sleep(750);
      const s = await logger.step("followup", "Enviando follow-up (2ª mensagem)", {
        conversation_id: conversationId,
        quick_replies: quickReplies.length,
        buttons: buttons.length,
        has_message: !!matching.followup_message,
      });
      try {
        const res = await zernioSendConversationMessage({
          apiKey,
          accountId,
          conversationId,
          message: matching.followup_message || matching.custom_message,
          quickReplies: quickReplies.length > 0 ? quickReplies : undefined,
          buttons: buttons.length > 0 ? buttons : undefined,
        });
        await s.success({ apiResponse: res });
        followupSent = true;
      } catch (e) {
        const p = await s.fail(e);
        stoppedAt = "followup";
        finalErr = friendlyZernioError(p.message);
      }
    }
  }

  await updateLog(logId, {
    message_sent: matching.custom_message,
  });

  await incrementAutomationCounter(matching.id, primarySent ? "sent" : "failed");

  // outgoing webhook
  if (primarySent && settings.outgoing_webhook_enabled && settings.outgoing_webhook_url) {
    const out = await logger.step("outgoing_webhook", "Notificando webhook externo do usuário", {
      url: settings.outgoing_webhook_url,
    });
    try {
      const r = await fetchWithTimeout(settings.outgoing_webhook_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(externalEventId ? { "Idempotency-Key": `${userId}:${externalEventId}` } : {}),
        },
        body: JSON.stringify({
          event: "dm.sent",
          automation_id: matching.id,
          instagram_user: comment.fromUsername,
          comment_text: comment.text,
          message_sent: matching.custom_message,
          timestamp: new Date().toISOString(),
        }),
      });
      if (!r.ok) {
        const body = await r
          .text()
          .then((text) => text.slice(0, 2_000))
          .catch(() => "");
        const err = new Error(`HTTP ${r.status}: ${body}`) as Error & {
          apiStatus: number;
          apiBody: unknown;
        };
        err.apiStatus = r.status;
        err.apiBody = body;
        await out.fail(err);
      } else {
        await out.success({ apiStatus: r.status });
      }
    } catch (e) {
      await out.fail(e);
    }
  }

  const status: "sent" | "failed" =
    primarySent && (!hasFollowup || followupSent) ? "sent" : "failed";
  return finish(logger, logId, {
    status,
    stoppedAtStep: stoppedAt,
    error: finalErr,
    responseBody: {
      sent: primarySent,
      followup_sent: followupSent,
      debug: {
        automation_id: matching.id,
        has_custom_message: !!matching.custom_message,
        has_followup_message: !!matching.followup_message,
        quick_replies_count: quickReplies.length,
        buttons_count: buttons.length,
      },
    },
  });
}

// silencia importação não usada de parseZernioError se necessário
void parseZernioError;
