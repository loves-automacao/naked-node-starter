export function matchedKeyword(text: string, keywords: string[]): string | null {
  const normalizedText = text.toLowerCase();

  for (const keyword of keywords) {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (normalizedKeyword && normalizedText.includes(normalizedKeyword)) return keyword;
  }

  return null;
}

type WebhookIdentityPayload = {
  id?: string;
  comment?: { id?: string };
  message?: { id?: string };
};

export function getWebhookEventId(
  eventType: string,
  payload: WebhookIdentityPayload,
): string | null {
  const candidate =
    eventType === "comment.received"
      ? (payload.comment?.id ?? payload.id)
      : eventType === "message.received"
        ? (payload.message?.id ?? payload.id)
        : payload.id;
  const normalized = candidate?.trim();
  return normalized || null;
}

export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

export function isWebhookBodyTooLarge(
  contentLength: string | null,
  body?: string,
  maxBytes = MAX_WEBHOOK_BODY_BYTES,
): boolean {
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) return true;
  }

  return body !== undefined && new TextEncoder().encode(body).byteLength > maxBytes;
}
