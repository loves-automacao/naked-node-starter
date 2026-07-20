// Server-only: cliente HTTP da Zernio.
// Endpoints validados conforme documentação oficial fornecida pelo suporte da Zernio.
const ZERNIO_BASE = process.env.ZERNIO_API_BASE || "https://zernio.com/api/v1";

interface ZernioFetchOpts {
  apiKey: string;
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
}

async function zernioFetch<T>({
  apiKey,
  path,
  method = "GET",
  body,
  timeoutMs = 5000,
}: ZernioFetchOpts): Promise<T> {
  // Timeout configurável. Como o webhook processa em background via ctx.waitUntil,
  // podemos tolerar chamadas longas sem bloquear a resposta ao provedor.
  // - findConversation / /accounts: 5s (default, GET rápido)
  // - private-reply / sendConversationMessage: 20s (Meta pode ser lento)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${ZERNIO_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`Zernio API timeout (>${timeoutMs}ms) em ${path}`);
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
  const text = await res.text();
  if (!res.ok) {
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep as raw text */
    }
    const err = new Error(`Zernio API ${res.status}: ${text || res.statusText}`) as Error & {
      apiStatus: number;
      apiBody: unknown;
    };
    err.apiStatus = res.status;
    err.apiBody = body;
    throw err;
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

interface ZernioAccount {
  _id: string;
  platform: string;
  username: string;
  isActive?: boolean;
}

export async function zernioGetInstagramAccount(
  apiKey: string,
): Promise<{ accountId: string | null; username: string | null }> {
  try {
    const data = await zernioFetch<{ accounts?: ZernioAccount[] }>({
      apiKey,
      path: "/accounts",
    });
    console.log("[zernio] /accounts response:", JSON.stringify(data));
    const ig = (data.accounts ?? []).find((a) => a.platform === "instagram");
    if (!ig) return { accountId: null, username: null };
    return { accountId: ig._id, username: ig.username };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[zernio] /accounts failed:", msg);
    throw new Error(`Falha ao consultar Zernio (/accounts): ${msg}`);
  }
}

interface ZernioCommentedPost {
  id: string;
  platform: string;
  accountId: string;
  permalink?: string;
}

/**
 * Resolve o Instagram media_id a partir de um shortcode (ex: DAxxxx) usando
 * a Zernio Comments API. A Zernio lista posts que já receberam comentários
 * pela conta conectada, expondo `id` (= platformPostId enviado no webhook) e
 * `permalink` — batemos o shortcode dentro do permalink.
 *
 * Limitação: o post precisa ter pelo menos 1 comentário pra aparecer na
 * listagem. Se não achar, retorna null e a UI orienta o usuário.
 */
export async function zernioResolvePostByShortcode(input: {
  apiKey: string;
  accountId: string;
  shortcode: string;
}): Promise<{ mediaId: string; permalink: string | null } | null> {
  const target = `/${input.shortcode}`;
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({
      platform: "instagram",
      accountId: input.accountId,
      limit: "100",
      minComments: "0",
    });
    if (cursor) qs.set("cursor", cursor);
    const data = await zernioFetch<{
      data?: ZernioCommentedPost[];
      pagination?: { hasMore?: boolean; nextCursor?: string };
    }>({
      apiKey: input.apiKey,
      path: `/inbox/comments?${qs.toString()}`,
      timeoutMs: 8000,
    });
    const hit = (data.data ?? []).find(
      (p) => p.accountId === input.accountId && (p.permalink ?? "").includes(target),
    );
    if (hit) return { mediaId: hit.id, permalink: hit.permalink ?? null };
    if (!data.pagination?.hasMore || !data.pagination.nextCursor) break;
    cursor = data.pagination.nextCursor;
  }
  return null;
}

// 1ª mensagem: Private reply ao comentário (não precisa janela de 24h, text only)
export async function zernioSendPrivateReply(input: {
  apiKey: string;
  accountId: string;
  postId: string;
  commentId: string;
  message: string;
}): Promise<{ messageId?: string }> {
  return zernioFetch({
    apiKey: input.apiKey,
    path: `/inbox/comments/${input.postId}/${input.commentId}/private-reply`,
    method: "POST",
    body: {
      accountId: input.accountId,
      message: input.message,
    },
    timeoutMs: 7000,
  });
}

interface ZernioConversation {
  _id?: string;
  id?: string;
  participantId?: string;
  participants?: Array<{ id?: string; platformUserId?: string }>;
}

export async function zernioFindConversationId(input: {
  apiKey: string;
  accountId: string;
  participantId: string;
}): Promise<string | null> {
  try {
    // Zernio retorna { data: [...] }, não { conversations: [...] }.
    // Cada conversation tem id (flat) e participantId (flat) no top-level.
    const data = await zernioFetch<{
      data?: ZernioConversation[];
      conversations?: ZernioConversation[];
    }>({
      apiKey: input.apiKey,
      path: `/inbox/conversations?accountId=${encodeURIComponent(input.accountId)}`,
    });
    const list = data.data ?? data.conversations ?? [];
    const conv = list.find((c) => {
      if (c.participantId === input.participantId) return true;
      return (c.participants ?? []).some(
        (p) => p.id === input.participantId || p.platformUserId === input.participantId,
      );
    });
    return conv?.id || conv?._id || null;
  } catch (e) {
    console.error("[zernio] /inbox/conversations failed:", e);
    return null;
  }
}

// 2ª mensagem: Follow-up via conversation (precisa janela de 24h aberta)
//
// Formato validado (confirmado pelo Elean do suporte Zernio, 2026-04-22):
//
// - `message`: string sempre no root
// - `quickReplies`: array no root (até 13) — {title, payload}
// - `template`: objeto no root pra botões web_url/postback
//     { type: "generic", elements: [{title, subtitle?, buttons: [...]}] }
//     buttons[].type = "url" (Zernio traduz pra web_url internamente) ou "postback"
//
// Dentro de 24h o Meta trata como RESPONSE por default — não precisa messagingType.
export async function zernioSendConversationMessage(input: {
  apiKey: string;
  accountId: string;
  conversationId: string;
  message: string;
  quickReplies?: { title: string; payload: string }[];
  buttons?: { type: string; title: string; payload?: string; url?: string }[];
  templateTitle?: string;
  templateSubtitle?: string;
  useHumanAgentTag?: boolean;
}): Promise<{ messageId?: string }> {
  const body: Record<string, unknown> = {
    accountId: input.accountId,
    message: input.message || "👇",
  };

  if (input.quickReplies && input.quickReplies.length > 0) {
    for (let i = 0; i < input.quickReplies.length; i++) {
      const q = input.quickReplies[i];
      const idx = i + 1;
      let reason: string | null = null;
      if (!q || typeof q.title !== "string")
        reason = `Quick reply #${idx}: campo obrigatório ausente: title`;
      else if (q.title.trim().length === 0) reason = `Quick reply #${idx}: "title" vazio`;
      else if (q.title.length > 20)
        reason = `Quick reply #${idx}: "title" possui ${q.title.length} caracteres. Máx 20.`;
      if (reason) {
        const err = new Error(`Quick reply inválido — ${reason}`) as Error & {
          apiStatus: number;
          apiBody: unknown;
        };
        err.apiStatus = 0;
        err.apiBody = { validation: reason, quickReply: q };
        throw err;
      }
    }
    body.quickReplies = input.quickReplies.slice(0, 13);
  }

  if (input.buttons && input.buttons.length > 0) {
    // Valida cada botão ANTES de montar payload — Meta rejeita title vazio/>80
    for (let i = 0; i < Math.min(input.buttons.length, 3); i++) {
      const b = input.buttons[i];
      const idx = i + 1;
      let reason: string | null = null;
      if (!b || typeof b.title !== "string")
        reason = `Botão #${idx}: campo obrigatório ausente: title`;
      else if (b.title.trim().length === 0) reason = `Botão #${idx}: o campo "title" está vazio`;
      else if (b.title.length > 80)
        reason = `Botão #${idx}: o campo "title" possui ${b.title.length} caracteres. O máximo permitido é 80.`;
      else if ((b.type === "web_url" || b.type === "url") && (!b.url || b.url.trim().length === 0))
        reason = `Botão #${idx}: URL ausente para botão de link`;
      if (reason) {
        const err = new Error(`Botão inválido — ${reason}`) as Error & {
          apiStatus: number;
          apiBody: unknown;
        };
        err.apiStatus = 0;
        err.apiBody = { validation: reason, button: b };
        throw err;
      }
    }

    const mappedButtons = input.buttons.slice(0, 3).map((b) => {
      const title = b.title.trim().slice(0, 80);
      if (b.type === "web_url" || b.type === "url") {
        return { type: "url", title, url: b.url ?? "" };
      }
      return { type: "postback", title, payload: b.payload ?? b.title };
    });

    // Meta exige element.title ≤80 chars. Trunca em vez de falhar quando a
    // mensagem legítima é longa (era a causa do "Template element title ... 80 or less").
    const rawElementTitle = (input.templateTitle || input.message || "👇").trim() || "👇";
    const elementTitle =
      rawElementTitle.length > 80 ? rawElementTitle.slice(0, 77) + "..." : rawElementTitle;
    const rawSubtitle = input.templateSubtitle?.trim();
    const subtitle =
      rawSubtitle && rawSubtitle.length > 80 ? rawSubtitle.slice(0, 77) + "..." : rawSubtitle;

    body.template = {
      type: "generic",
      elements: [
        {
          title: elementTitle,
          subtitle,
          buttons: mappedButtons,
        },
      ],
    };
  }

  if (input.useHumanAgentTag) {
    body.messagingType = "MESSAGE_TAG";
    body.messageTag = "HUMAN_AGENT";
  }

  // Payload completo logado antes do envio pra facilitar diagnóstico.
  console.log(
    "[zernio] sendConversationMessage payload:",
    JSON.stringify({ conversationId: input.conversationId, body }, null, 2),
  );

  return zernioFetch({
    apiKey: input.apiKey,
    path: `/inbox/conversations/${input.conversationId}/messages`,
    method: "POST",
    body,
    timeoutMs: 7000,
  });
}
