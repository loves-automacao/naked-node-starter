import { requireEnvironment, requireHttpUrl } from "./env-validation";

// Fallbacks públicos do backend Lovable Cloud deste projeto.
// A URL e a publishable key são valores públicos (safe em código) e servem
// de fallback quando o build de produção não tem VITE_SUPABASE_* injetadas.
const FALLBACK_SUPABASE_URL = "https://ldzomiycbuztlykjyubd.supabase.co";
const FALLBACK_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_aiUs9nbrlVJGL7_Tk4fzfQ_yRiiHDR4";

export function getPublicSupabaseConfig() {
  const source = {
    SUPABASE_URL:
      import.meta.env.VITE_SUPABASE_URL ||
      (typeof process !== "undefined" ? process.env.SUPABASE_URL : undefined) ||
      FALLBACK_SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY:
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      (typeof process !== "undefined" ? process.env.SUPABASE_PUBLISHABLE_KEY : undefined) ||
      FALLBACK_SUPABASE_PUBLISHABLE_KEY,
  };
  const env = requireEnvironment(source, ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"]);
  return {
    url: requireHttpUrl(env.SUPABASE_URL, "SUPABASE_URL"),
    key: env.SUPABASE_PUBLISHABLE_KEY,
  };
}

