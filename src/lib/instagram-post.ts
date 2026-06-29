// Helpers pra normalizar o identificador de post do Instagram.
// O Zernio envia no webhook o media id numérico (ex: 17931201761893324),
// então qualquer URL/shortcode precisa ser decodificado pra esse formato
// na hora de salvar; senão o matcher do webhook nunca casa.

const IG_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function shortcodeToMediaId(shortcode: string): string | null {
  if (!shortcode) return null;
  let id = 0n;
  for (const c of shortcode) {
    const v = IG_ALPHABET.indexOf(c);
    if (v < 0) return null;
    id = id * 64n + BigInt(v);
  }
  return id.toString();
}

/**
 * Aceita: "*", media id numérico (10-25 dígitos), shortcode puro
 * (Cxxxx), ou URL completa (com query/trailing slash). Retorna null
 * quando não consegue extrair um ID válido.
 */
export function extractPostId(input: string): string | null {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return null;
  if (trimmed === "*") return "*";
  if (/^\d{10,25}$/.test(trimmed)) return trimmed;

  // URL completa: pega o shortcode após /p/, /reel/ ou /tv/, ignorando
  // trailing slash, query string e fragmento.
  const urlMatch = trimmed.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
  const shortcode = urlMatch
    ? urlMatch[1]
    : /^[A-Za-z0-9_-]{5,30}$/.test(trimmed)
    ? trimmed
    : null;

  if (!shortcode) return null;
  return shortcodeToMediaId(shortcode);
}
