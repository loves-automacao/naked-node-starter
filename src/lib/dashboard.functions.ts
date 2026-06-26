import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { detectAndPersistPublicOrigin } from "./detect-origin.server";

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    // Detectar e persistir URL pública no primeiro acesso ao dashboard via domínio publicado.
    await detectAndPersistPublicOrigin(supabase, userId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [{ data: automations }, { count: todayCount }] = await Promise.all([
      supabase
        .from("automations")
        .select("is_active,total_sent,total_failed")
        .eq("user_id", userId),
      supabase
        .from("automation_logs")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "sent")
        .gte("created_at", today.toISOString()),
    ]);

    const all = automations ?? [];
    const totalSent = all.reduce((s, a) => s + (a.total_sent ?? 0), 0);
    const totalFailed = all.reduce((s, a) => s + (a.total_failed ?? 0), 0);
    const total = totalSent + totalFailed;
    const successRate = total === 0 ? null : (totalSent / total) * 100;
    const activeAutomations = all.filter((a) => a.is_active).length;

    return {
      total_sent: totalSent,
      success_rate: successRate,
      active_automations: activeAutomations,
      replies_today: todayCount ?? 0,
    };
  });
