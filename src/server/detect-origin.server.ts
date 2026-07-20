import { getRequestHeader, getRequestHost } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";

function detectPublicAppOrigin(): string | null {
  try {
    const forwardedHost = getRequestHeader("x-forwarded-host");
    const host = forwardedHost || getRequestHost();
    if (!host) return null;
    const hostname = host.split(":")[0].toLowerCase();
    const isPreview =
      hostname.endsWith(".lovableproject.com") ||
      hostname.startsWith("id-preview--") ||
      hostname === "localhost" ||
      hostname === "127.0.0.1";
    if (isPreview) return null;
    const proto = getRequestHeader("x-forwarded-proto") || "https";
    return `${proto}://${host}`;
  } catch {
    return null;
  }
}

/**
 * Detecta a URL pública do app a partir do header Host e persiste em
 * user_settings.published_origin. Silencioso — nunca quebra a server function.
 * Retorna a origem detectada (ou null se for preview).
 */
export async function detectAndPersistPublicOrigin(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  try {
    const detected = detectPublicAppOrigin();
    if (!detected) return null;

    const { data: existing } = await supabase
      .from("user_settings")
      .select("published_origin")
      .eq("user_id", userId)
      .maybeSingle();

    const stored =
      (existing as { published_origin?: string | null } | null)?.published_origin ?? null;
    if (detected !== stored) {
      await supabase
        .from("user_settings")
        .update({ published_origin: detected })
        .eq("user_id", userId);
    }
    return detected;
  } catch {
    return null;
  }
}
