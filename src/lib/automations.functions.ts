import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { detectAndPersistPublicOrigin } from "@/server/detect-origin.server";

export interface AutomationInput {
  id?: string;
  name: string;
  instagram_post_id: string;
  instagram_post_type: string;
  custom_message: string;
  followup_message: string;
  quick_replies: { title: string; payload: string }[];
  buttons: { type: string; title: string; payload?: string; url?: string }[];
  is_active: boolean;
  keyword_filter_enabled: boolean;
  keywords: string[];
  delay_min_seconds: number;
  delay_max_seconds: number;
  trigger_on_dm?: boolean;
}

function validate(input: AutomationInput): AutomationInput {
  if (!input.name || input.name.length > 200) throw new Error("Nome inválido");
  if (!input.instagram_post_id) throw new Error("Post ID é obrigatório");
  const min = Math.max(30, Math.min(120, input.delay_min_seconds || 30));
  const max = Math.max(min, Math.min(120, input.delay_max_seconds || 60));
  
  return {
    ...input,
    custom_message: input.custom_message ?? "",
    followup_message: input.followup_message ?? "",
    delay_min_seconds: min,
    delay_max_seconds: max,
    quick_replies: (input.quick_replies || []).slice(0, 13),
    buttons: (input.buttons || []).slice(0, 3),
    keywords: (input.keywords || []).map((k) => k.trim().toLowerCase()).filter(Boolean),
  };
}

export const listAutomations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await detectAndPersistPublicOrigin(supabase, userId);
    const { data, error } = await supabase
      .from("automations")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { automations: data ?? [] };
  });

export const createAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: AutomationInput) => validate(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("automations")
      .insert({
        user_id: userId,
        name: data.name,
        instagram_post_id: data.instagram_post_id,
        instagram_post_type: data.instagram_post_type,
        custom_message: data.custom_message,
        followup_message: data.followup_message,
        quick_replies: data.quick_replies,
        buttons: data.buttons,
        is_active: data.is_active,
        keyword_filter_enabled: data.keyword_filter_enabled,
        keywords: data.keywords,
        delay_min_seconds: data.delay_min_seconds,
        delay_max_seconds: data.delay_max_seconds,
        trigger_on_dm: data.trigger_on_dm ?? false,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { automation: row };
  });

export const getAutomation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("automations")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Automação não encontrada");
    return { automation: row };
  });

export const updateAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: AutomationInput & { id: string }) => ({ ...validate(input), id: input.id }))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { id, ...rest } = data;
    
    const { data: row, error } = await supabase
      .from("automations")
      .update({
        name: rest.name,
        instagram_post_id: rest.instagram_post_id,
        instagram_post_type: rest.instagram_post_type,
        custom_message: rest.custom_message ?? "",
        followup_message: rest.followup_message ?? "",
        quick_replies: rest.quick_replies,
        buttons: rest.buttons,
        is_active: rest.is_active,
        keyword_filter_enabled: rest.keyword_filter_enabled,
        keywords: rest.keywords,
        delay_min_seconds: rest.delay_min_seconds,
        delay_max_seconds: rest.delay_max_seconds,
        trigger_on_dm: rest.trigger_on_dm ?? false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { automation: row };
  });

export const toggleAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; is_active: boolean }) => input)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("automations")
      .update({ is_active: data.is_active })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const deleteAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("automations").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { success: true };
  });
