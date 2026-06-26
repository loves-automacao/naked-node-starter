import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { encryptString, decryptString } from "./crypto.server";
import { zernioGetInstagramAccount } from "./zernio.server";
import { detectAndPersistPublicOrigin } from "@/server/detect-origin.server";

export const getSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const detected = await detectAndPersistPublicOrigin(supabase, userId);

    const [{ data: settings }, { data: profile }] = await Promise.all([
      supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("profiles").select("webhook_token,email,name").eq("id", userId).maybeSingle(),
    ]);

    const stored = (settings as { published_origin?: string | null } | null)?.published_origin ?? null;
    const publicAppOrigin = detected ?? stored;

    return {
      publicAppOrigin,
      settings: {
        has_api_key: !!settings?.zernio_api_key_encrypted,
        instagram_username: settings?.instagram_username ?? null,
        instagram_connected: !!settings?.instagram_connected,
        outgoing_webhook_url: settings?.outgoing_webhook_url ?? "",
        outgoing_webhook_enabled: !!settings?.outgoing_webhook_enabled,
      },
      profile: {
        webhook_token: profile?.webhook_token ?? null,
        email: profile?.email ?? null,
        name: profile?.name ?? null,
      },
    };
  });

export const saveZernioApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { apiKey: string }) => {
    if (!input.apiKey || input.apiKey.length < 8 || input.apiKey.length > 500) {
      throw new Error("API Key inválida");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const encrypted = encryptString(data.apiKey.trim());
    const { error } = await supabase
      .from("user_settings")
      .upsert({ user_id: userId, zernio_api_key_encrypted: encrypted }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const connectInstagram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: settings } = await supabase
      .from("user_settings")
      .select("zernio_api_key_encrypted")
      .eq("user_id", userId)
      .maybeSingle();
    if (!settings?.zernio_api_key_encrypted) {
      throw new Error("Salve sua API Key da Zernio antes de conectar.");
    }
    const apiKey = decryptString(settings.zernio_api_key_encrypted);
    const { accountId, username } = await zernioGetInstagramAccount(apiKey);
    if (!accountId || !username) {
      throw new Error("Conecte primeiro sua conta Instagram na Zernio.");
    }
    const { error } = await supabase
      .from("user_settings")
      .update({
        instagram_username: username,
        instagram_connected: true,
        zernio_account_id: accountId,
      })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { username };
  });

export const disconnectInstagram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("user_settings")
      .update({ instagram_connected: false, instagram_username: null })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const clearPublishedOrigin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("user_settings")
      .update({ published_origin: null })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const saveOutgoingWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { url: string; enabled: boolean }) => {
    if (input.url && input.url.length > 2000) throw new Error("URL muito longa");
    if (input.url && !/^https?:\/\//.test(input.url)) throw new Error("URL deve começar com http(s)://");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("user_settings")
      .update({ outgoing_webhook_url: data.url || null, outgoing_webhook_enabled: data.enabled })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const testConfiguration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: settings } = await supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    const { data: profile } = await supabase
      .from("profiles")
      .select("webhook_token")
      .eq("id", userId)
      .maybeSingle();

    // Valida que a API key salva consegue ser descriptografada de verdade.
    let apiKeyStatus: "ok" | "fail" = "fail";
    let apiKeyDetail: string | undefined = "API Key não configurada";
    if (settings?.zernio_api_key_encrypted) {
      try {
        const decrypted = decryptString(settings.zernio_api_key_encrypted);
        if (decrypted && decrypted.length >= 8) {
          apiKeyStatus = "ok";
          apiKeyDetail = undefined;
        } else {
          apiKeyDetail = "API Key inválida — salve novamente.";
        }
      } catch {
        apiKeyDetail =
          "Falha ao descriptografar a API Key (segredo do servidor mudou). Salve a chave novamente.";
      }
    }

    return {
      results: [
        { step: "Autenticação", status: "ok" as const },
        { step: "Zernio API Key", status: apiKeyStatus, detail: apiKeyDetail },
        {
          step: "Instagram conectado",
          status: settings?.instagram_connected ? ("ok" as const) : ("fail" as const),
          detail: settings?.instagram_connected
            ? `@${settings.instagram_username}`
            : "Conecte seu Instagram",
        },
        {
          step: "Webhook endpoint",
          status: profile?.webhook_token ? ("ok" as const) : ("fail" as const),
          detail: profile?.webhook_token,
        },
      ],
    };
  });
