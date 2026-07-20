import { requireEnvironment, requireHttpUrl } from "./env-validation";

export function getPublicSupabaseConfig() {
  const source = {
    SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY:
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY,
  };
  const env = requireEnvironment(source, ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"]);
  return {
    url: requireHttpUrl(env.SUPABASE_URL, "SUPABASE_URL"),
    key: env.SUPABASE_PUBLISHABLE_KEY,
  };
}
