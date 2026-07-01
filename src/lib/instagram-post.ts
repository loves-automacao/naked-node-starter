// Helpers puros pra normalizar o identificador de post do Instagram no CLIENTE.
//
// O Zernio envia no webhook o `platformPostId` (media_id numérico, ex:
// 17931201761893324). Esse ID NÃO é o resultado do base64-decode do shortcode
// (o valor de base64 é matematicamente diferente). Portanto:
//
// - "*" e IDs numéricos são passados direto.
// - Shortcodes / URLs precisam ser resolvidos SERVER-SIDE via Zernio Comments
//   API (ver `resolveInstagramMediaId` em `src/lib/instagram-post.functions.ts`).
//
// Este arquivo só classifica o input; a resolução é feita em um server fn.

export type PostInputParsed =
  | { kind: "wildcard" }
  | { kind: "mediaId"; value: string }
  | { kind: "shortcode"; value: string }
  | null;

export function parsePostInput(input: string): PostInputParsed {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return null;
  if (trimmed === "*") return { kind: "wildcard" };
  if (/^\d{10,25}$/.test(trimmed)) return { kind: "mediaId", value: trimmed };

  // URL completa: pega o shortcode após /p/, /reel/ ou /tv/ (aceita trailing
  // slash, query string e fragmento).
  const urlMatch = trimmed.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
  const shortcode = urlMatch
    ? urlMatch[1]
    : /^[A-Za-z0-9_-]{5,30}$/.test(trimmed)
    ? trimmed
    : null;

  if (!shortcode) return null;
  return { kind: "shortcode", value: shortcode };
}
