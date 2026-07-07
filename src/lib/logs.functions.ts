import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("automation_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return { logs: data ?? [] };
  });

export const getLogSteps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { logId: string }) => {
    if (!data?.logId || typeof data.logId !== "string") throw new Error("logId required");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const stepsTable = supabase.from("automation_log_steps" as never) as unknown as {
      select: (c: string) => {
        eq: (col: string, val: string) => {
          order: (col: string, opts: { ascending: boolean }) => Promise<{ data: LogStep[] | null; error: { message: string } | null }>;
        };
      };
    };
    const { data: steps, error } = await stepsTable
      .select("*")
      .eq("log_id", data.logId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { steps: (steps ?? []) as LogStep[] };
  });

export interface LogStep {
  id: string;
  log_id: string;
  user_id: string;
  step: string;
  label: string;
  status: "started" | "success" | "failed" | "skipped";
  duration_ms: number | null;
  error_message: string | null;
  api_status_code: number | null;
  api_response: unknown;
  context: Record<string, unknown> | null;
  created_at: string;
}
