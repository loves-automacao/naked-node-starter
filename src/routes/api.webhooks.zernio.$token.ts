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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Signature",
};

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

function matchesKeywords(text: string, keywords: string[]): boolean {
  if (!keywords || keywords.length === 0) return true;
  const t = text.toLowerCase();
  return keywords.some((k) => t.includes(k.toLowerCase()));
}

function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1) + min) * 1000;
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

      // GET para verificação de webhook (alguns provedores fazem handshake)
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const challenge = url.searchParams.get("hub.challenge");
        if (challenge) return new Response(challenge, { status: 200, headers: corsHeaders });
        return new Response("ok", { status: 200, headers: corsHeaders });
      },

      POST: async ({ request, params }) => {
        // Wrapper geral pra NUNCA retornar 5xx — Zernio deve sempre receber 2xx
        // pra não tentar reenviar o mesmo evento
        try {
          return await handleWebhookPost({ request, params });
        } catch (e) {
          console.error("[webhook] uncaught error:", e);
          return new Response(
            JSON.stringify({ ok: true, error: "internal", message: e instanceof Error ? e.message : String(e) }),
            { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
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
};

async function updateLog(logId: string | null, patch: LogPatch): Promise<void> {
  if (!logId) return;
  const { error } = await supabaseAdmin
    .from("automation_logs")
    .update(patch)
    .eq("id", logId);
  if (error) console.error("[webhook] updateLog failed:", error.message);
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

  // Identifica o usuário pelo token
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("webhook_token", token)
    .maybeSingle();

  if (!profile) return jsonResponse({ error: "unknown token" }, 404);
  const userId = profile.id;

  // Lê o body cru
  let rawBodyText = "";
  let rawPayload: ZernioCommentEvent & ZernioMessageEvent = {};
  try {
    rawBodyText = await request.text();
    if (rawBodyText) {
      rawPayload = JSON.parse(rawBodyText) as ZernioCommentEvent & ZernioMessageEvent;
    }
  } catch {
    // Cria log explícito de payload inválido
    await supabaseAdmin.from("automation_logs").insert({
      user_id: userId,
      status: "received",
      error: `invalid_json: ${rawBodyText.slice(0, 200)}`,
    });
    return jsonResponse({ error: "invalid json" }, 400);
  }

  const eventType = rawPayload.event ?? "unknown";

  // ── LOG INICIAL SÍNCRONO: cria registro e guarda o id pra atualizar depois ──
  const { data: logRow } = await supabaseAdmin
    .from("automation_logs")
    .insert({
      user_id: userId,
      status: "received",
      comment_text: rawPayload.comment?.text ?? rawPayload.message?.text ?? null,
      instagram_user:
        rawPayload.comment?.author?.username ??
        rawPayload.message?.sender?.username ??
        null,
      instagram_post_id:
        rawPayload.comment?.platformPostId ?? rawPayload.post?.platformPostId ?? null,
      error: `event=${eventType}`,
    })
    .select("id")
    .maybeSingle();

  const logId = logRow?.id ?? null;

  // ── message.received ──
  if (eventType === "message.received" && rawPayload.message) {
    const msg = rawPayload.message;
    const senderId = msg.sender?.id;
    const senderUsername = msg.sender?.username;
    const payloadFromClick = msg.quickReply?.payload;
    const conversationId = msg.conversationId;
    const isFollower = msg.sender?.instagramProfile?.isFollower ?? null;

    if (!senderId || !conversationId) {
      await updateLog(logId, { status: "skipped", error: "incomplete_message" });
      return jsonResponse({ ok: true, ignored: "incomplete_message" });
    }

    if (rawPayload.account?.username && senderUsername === rawPayload.account.username) {
      await updateLog(logId, { status: "skipped", error: "self_message" });
      return jsonResponse({ ok: true, ignored: "self_message" });
    }

    const { data: settings } = await supabaseAdmin
      .from("user_settings")
      .select("zernio_api_key_encrypted,zernio_account_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (!settings?.zernio_api_key_encrypted || !settings?.zernio_account_id) {
      await updateLog(logId, { status: "skipped", error: "no_api_key_or_account" });
      return jsonResponse({ ok: true, skipped: "no_api_key" });
    }

    let apiKey: string;
    try {
      apiKey = decryptString(settings.zernio_api_key_encrypted);
    } catch (e) {
      const em = e instanceof Error ? e.message : String(e);
      console.error("[webhook/message] decrypt failed:", em);
      await updateLog(logId, {
        status: "failed",
        error: `decrypt_failed: ${em}. Salve a API Key novamente.`,
      });
      return jsonResponse({ ok: true, error: "decrypt_failed" });
    }

    if (isFollower === false) {
      try {
        await zernioSendConversationMessage({
          apiKey,
          accountId: settings.zernio_account_id,
          conversationId,
          message:
            "Esse conteúdo é exclusivo para seguidores! Me segue e clica em 'Pronto' de novo 😉",
          quickReplies: [{ title: "Pronto! ✅", payload: "SEND_CONTENT" }],
        });
        await updateLog(logId, { status: "sent", message_sent: "follower_gate" });
      } catch (e) {
        const em = e instanceof Error ? e.message : String(e);
        await updateLog(logId, { status: "failed", error: `follower_gate: ${em}` });
      }
      return jsonResponse({ ok: true, action: "follower_gate" });
    }

    if (payloadFromClick) {
      const { data: autos } = await supabaseAdmin
        .from("automations")
        .select("*")
        .eq("user_id", userId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1);

      const matching = autos?.[0];
      const contentMessage =
        matching?.followup_message || matching?.custom_message || "Aqui está o conteúdo! 🎉";

      try {
        await zernioSendConversationMessage({
          apiKey,
          accountId: settings.zernio_account_id,
          conversationId,
          message: contentMessage,
        });
        await updateLog(logId, {
          status: "sent",
          message_sent: contentMessage,
          automation_id: matching?.id ?? null,
        });
        return jsonResponse({ ok: true, action: "content_delivered" });
      } catch (e) {
        const em = e instanceof Error ? e.message : String(e);
        await updateLog(logId, { status: "failed", error: `deliver: ${em}` });
        return jsonResponse({ ok: true, action: "delivery_failed" });
      }
    }

    // DM direta sem quick reply → procura automação com trigger_on_dm
    const messageText = msg.text || "";
    const { data: dmAutos } = await supabaseAdmin
      .from("automations")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .eq("trigger_on_dm", true);

    const matchingDm = (dmAutos ?? []).find((a) => {
      if (a.keyword_filter_enabled && !matchesKeywords(messageText, a.keywords ?? [])) {
        return false;
      }
      return true;
    });

    if (!matchingDm) {
      await updateLog(logId, { status: "skipped", error: "no_dm_trigger_match" });
      return jsonResponse({ ok: true, ignored: "no_dm_trigger_match" });
    }

    const dmMessage = matchingDm.followup_message || matchingDm.custom_message;
    const dmQuickReplies = (matchingDm.quick_replies as { title: string; payload: string }[]) ?? [];
    const dmButtons =
      (matchingDm.buttons as { type: string; title: string; payload?: string; url?: string }[]) ?? [];

    try {
      await zernioSendConversationMessage({
        apiKey,
        accountId: settings.zernio_account_id,
        conversationId,
        message: dmMessage,
        quickReplies: dmQuickReplies.length > 0 ? dmQuickReplies : undefined,
        buttons: dmButtons.length > 0 ? dmButtons : undefined,
      });
      await updateLog(logId, {
        status: "sent",
        automation_id: matchingDm.id,
        message_sent: dmMessage,
      });
      await supabaseAdmin
        .from("automations")
        .update({ total_sent: (matchingDm.total_sent ?? 0) + 1 })
        .eq("id", matchingDm.id);
      return jsonResponse({ ok: true, action: "dm_trigger_sent" });
    } catch (e) {
      const em = e instanceof Error ? e.message : String(e);
      await updateLog(logId, {
        status: "failed",
        automation_id: matchingDm.id,
        error: `dm_trigger: ${em}`,
      });
      return jsonResponse({ ok: true, action: "dm_trigger_failed" });
    }
  }

  // ── comment.received ──
  if (eventType !== "comment.received" || !rawPayload.comment) {
    await updateLog(logId, { status: "skipped", error: `ignored_event=${eventType}` });
    return jsonResponse({ ok: true, ignored: eventType });
  }

  const payload = rawPayload as ZernioCommentEvent;
  const pc = payload.comment!;
  const comment = {
    commentId: pc.id,
    text: pc.text || "",
    fromId: pc.author?.id,
    fromUsername: pc.author?.username,
    postId: pc.platformPostId || payload.post?.platformPostId,
  };

  if (!comment.commentId || !comment.fromId || !comment.postId) {
    await updateLog(logId, { status: "skipped", error: "incomplete_comment" });
    return jsonResponse({ ok: true, ignored: "incomplete_comment" });
  }

  // Narrowed non-null pra usar dentro do closure de background
  const commentId = comment.commentId;
  const fromId = comment.fromId;
  const postId = comment.postId;

  const [{ data: settings }, { data: autos }] = await Promise.all([
    supabaseAdmin
      .from("user_settings")
      .select(
        "zernio_api_key_encrypted,zernio_account_id,outgoing_webhook_url,outgoing_webhook_enabled"
      )
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin.from("automations").select("*").eq("user_id", userId).eq("is_active", true),
  ]);

  if (!settings?.zernio_api_key_encrypted || !settings?.zernio_account_id) {
    await updateLog(logId, { status: "skipped", error: "no_api_key_or_account" });
    return jsonResponse({ ok: true, skipped: "no_api_key_or_account" });
  }

  const matching = (autos ?? []).find((a) => {
    if (a.instagram_post_id !== "*" && a.instagram_post_id !== comment.postId) return false;
    if (a.keyword_filter_enabled && !matchesKeywords(comment.text, a.keywords ?? [])) return false;
    return true;
  });

  if (!matching) {
    await updateLog(logId, {
      status: "skipped",
      error: "Nenhuma automação compatível (post/keyword)",
    });
    return jsonResponse({ ok: true, skipped: "no_match" });
  }

  let apiKey: string;
  try {
    apiKey = decryptString(settings.zernio_api_key_encrypted);
  } catch (e) {
    const em = e instanceof Error ? e.message : String(e);
    console.error("[webhook/comment] decrypt failed:", em);
    await updateLog(logId, {
      status: "failed",
      automation_id: matching.id,
      error: `decrypt_failed: ${em}. Salve a API Key novamente.`,
    });
    return jsonResponse({ ok: true, error: "decrypt_failed" });
  }

  const accountId = settings.zernio_account_id;

  // Defensivo: jsonb do Supabase pode vir como string, array, ou null.
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

  const hasFollowup =
    !!matching.followup_message || quickReplies.length > 0 || buttons.length > 0;

  // ══════════════════════════════════════════════════════════════════
  // PROCESSAMENTO SÍNCRONO
  //
  // Tentamos background (waitUntil) antes mas o runtime do CF Worker
  // mata a promise mesmo com waitUntil retornado com sucesso. Como a
  // Zernio validou que as chamadas /private-reply e /messages são
  // rápidas (<2s em testes diretos), voltamos ao síncrono: aguardamos
  // tudo e retornamos o resultado final.
  //
  // Tempo total esperado: 3-6s. Cabe no timeout ~10s da Zernio.
  // ══════════════════════════════════════════════════════════════════

  const processInBackground = async () => {
    let primarySent = false;
    let primaryErr: string | null = null;
    let followupSent = false;
    let followupErr: string | null = null;

    const privateReplyPromise = matching.custom_message
      ? zernioSendPrivateReply({
          apiKey,
          accountId,
          postId,
          commentId,
          message: matching.custom_message,
        })
          .then(() => ({ ok: true as const }))
          .catch((e) => ({ ok: false as const, err: e instanceof Error ? e.message : String(e) }))
      : Promise.resolve({ ok: true as const });

    const findConvPromise = hasFollowup
      ? zernioFindConversationId({
          apiKey,
          accountId,
          participantId: fromId,
        })
      : Promise.resolve(null);

    const [primaryRes, convId1] = await Promise.all([privateReplyPromise, findConvPromise]);

    if (primaryRes.ok) {
      primarySent = true;
      console.log("[webhook/bg] private reply sent ok");
    } else {
      primaryErr = primaryRes.err;
      console.error("[webhook/bg] private reply failed:", primaryErr);
    }

    if (primarySent && hasFollowup) {
      let conversationId = convId1;
      if (!conversationId) {
        console.log("[webhook/bg] conv not found in 1st pass, retrying...");
        conversationId = await zernioFindConversationId({
          apiKey,
          accountId,
          participantId: fromId,
        });
      }

      if (conversationId) {
        const followupParams = {
          apiKey,
          accountId,
          conversationId,
          message: matching.followup_message || matching.custom_message,
          quickReplies: quickReplies.length > 0 ? quickReplies : undefined,
          buttons: buttons.length > 0 ? buttons : undefined,
        };
        try {
          await zernioSendConversationMessage(followupParams);
          followupSent = true;
          console.log("[webhook/bg] follow-up sent ok");
        } catch (err) {
          followupErr = err instanceof Error ? err.message : String(err);
          console.error("[webhook/bg] follow-up failed:", followupErr);
        }
      } else {
        followupErr = "conversation not found after retry";
        console.warn("[webhook/bg] follow-up skipped: conv not found");
      }
    }

    const finalStatus = primarySent ? "sent" : "failed";
    const rawErr = primaryErr || followupErr;
    const finalErr = rawErr ? friendlyZernioError(rawErr) : null;

    try {
      await updateLog(logId, {
        automation_id: matching.id,
        message_sent: matching.custom_message,
        status: finalStatus,
        error: finalErr,
      });
      await supabaseAdmin
        .from("automations")
        .update(
          primarySent
            ? { total_sent: (matching.total_sent ?? 0) + 1 }
            : { total_failed: (matching.total_failed ?? 0) + 1 }
        )
        .eq("id", matching.id);

      if (primarySent && settings.outgoing_webhook_enabled && settings.outgoing_webhook_url) {
        await fetch(settings.outgoing_webhook_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "dm.sent",
            automation_id: matching.id,
            instagram_user: comment.fromUsername,
            comment_text: comment.text,
            message_sent: matching.custom_message,
            timestamp: new Date().toISOString(),
          }),
        }).catch((e) => console.error("[webhook/bg] outgoing webhook failed:", e));
      }
    } catch (e) {
      console.error("[webhook/bg] post-processing failed:", e);
    }

    return { primarySent, followupSent, finalErr };
  };

  // Síncrono: aguarda tudo antes de responder.
  const result = await processInBackground();

  return jsonResponse({
    ok: true,
    sent: result.primarySent,
    followup_sent: result.followupSent,
    debug: {
      automation_id: matching.id,
      has_custom_message: !!matching.custom_message,
      has_followup_message: !!matching.followup_message,
      quick_replies_count: quickReplies.length,
      buttons_count: buttons.length,
    },
    error: result.finalErr,
  });
}
