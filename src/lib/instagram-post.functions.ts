import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parsePostInput } from "@/lib/instagram-post";
import { decryptString } from "@/server/crypto.server";
import { zernioResolvePostByShortcode } from "@/server/zernio.server";

/**
 * Resolve o input do usuário (URL/shortcode/ID/*) para o media_id numérico
 * que a Zernio envia no webhook (`platformPostId`).
 *
 * - "*"  → devolve "*" (wildcard, casa qualquer post).
 * - ID numérico → passa direto.
 * - Shortcode/URL → consulta Zernio (`/v1/inbox/comments`) filtrando pela
 *   conta IG conectada e casando o shortcode dentro do `permalink`.
 *
 * Limitação: a listagem só inclui posts com ≥1 comentário. Se o post ainda
 * não tem comentário, o usuário precisa colar o media_id numérico direto ou
 * comentar o próprio post antes de criar a automação.
 */
export const resolveInstagramMediaId = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { input: string }) => input)
  .handler(async ({ data, context }) => {
    const parsed = parsePostInput(data.input);
    if (!parsed) {
      throw new Error(
        "Formato inválido. Cole a URL do post (ex: instagram.com/p/Cxxxx), o shortcode, o ID numérico ou '*'."
      );
    }
    if (parsed.kind === "wildcard") return { mediaId: "*", permalink: null };
    if (parsed.kind === "mediaId") return { mediaId: parsed.value, permalink: null };

    const { supabase, userId } = context;
    const { data: settings, error } = await supabase
      .from("user_settings")
      .select("zernio_api_key_encrypted, zernio_account_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!settings?.zernio_api_key_encrypted || !settings?.zernio_account_id) {
      throw new Error(
        "Conecte sua conta Zernio em Settings antes de criar automação por shortcode."
      );
    }
    const apiKey = await decryptString(settings.zernio_api_key_encrypted);
    const resolved = await zernioResolvePostByShortcode({
      apiKey,
      accountId: settings.zernio_account_id,
      shortcode: parsed.value,
    });
    if (!resolved) {
      throw new Error(
        "Post não encontrado na Zernio. Ele precisa ter pelo menos 1 comentário pra ser listado — comente uma vez e tente de novo, ou cole o media_id numérico direto."
      );
    }
    return resolved;
  });
