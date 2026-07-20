import { requireEnvironment, requireHttpUrl, type EnvironmentSource } from "./env-validation";

function serverSource(): EnvironmentSource {
  return {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    INSTAREPLY_ENCRYPTION_KEY: process.env.INSTAREPLY_ENCRYPTION_KEY,
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    ZERNIO_API_BASE: process.env.ZERNIO_API_BASE,
  };
}

export function getServerSupabasePublicConfig(source = serverSource()) {
  const env = requireEnvironment(source, ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"]);
  return {
    url: requireHttpUrl(env.SUPABASE_URL, "SUPABASE_URL"),
    key: env.SUPABASE_PUBLISHABLE_KEY,
  };
}

export function getServerSupabaseAdminConfig(source = serverSource()) {
  const env = requireEnvironment(source, ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  return {
    url: requireHttpUrl(env.SUPABASE_URL, "SUPABASE_URL"),
    key: env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

export function getZernioApiBase(source = serverSource()): string {
  return requireHttpUrl(source.ZERNIO_API_BASE || "https://zernio.com/api/v1", "ZERNIO_API_BASE");
}

export function getEncryptionSecretCandidates(source = serverSource()): string[] {
  return [
    ...new Set(
      [
        source.INSTAREPLY_ENCRYPTION_KEY,
        source.SUPABASE_URL,
        source.VITE_SUPABASE_URL,
        source.SUPABASE_SERVICE_ROLE_KEY,
        source.SUPABASE_PUBLISHABLE_KEY,
        source.VITE_SUPABASE_PUBLISHABLE_KEY,
      ]
        .filter((value): value is string => !!value?.trim())
        .map((value) => value.trim()),
    ),
  ];
}
