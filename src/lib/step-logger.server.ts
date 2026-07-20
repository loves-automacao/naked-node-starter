// Server-only helper para registrar cada etapa de uma execução de automação.
// Cada passo é uma linha em `automation_log_steps`, com timestamp, status,
// duração, e (quando aplicável) status/corpo da resposta da API externa.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type StepStatus = "started" | "success" | "failed" | "skipped";

export interface ZernioApiError extends Error {
  apiStatus?: number;
  apiBody?: unknown;
}

export function parseZernioError(e: unknown): { message: string; status?: number; body?: unknown } {
  if (e && typeof e === "object") {
    const err = e as ZernioApiError;
    if (typeof err.apiStatus === "number") {
      return { message: err.message, status: err.apiStatus, body: err.apiBody };
    }
  }
  const message = e instanceof Error ? e.message : String(e);
  const m = message.match(/Zernio API (\d{3}):\s*([\s\S]*)/);
  if (m) {
    const status = Number(m[1]);
    let body: unknown = m[2];
    try {
      body = JSON.parse(m[2]);
    } catch {
      /* keep as string */
    }
    return { message, status, body };
  }
  return { message };
}

interface StepHandle {
  success: (opts?: {
    apiResponse?: unknown;
    apiStatus?: number;
    extraContext?: Record<string, unknown>;
  }) => Promise<void>;
  fail: (
    err: unknown,
    opts?: { extraContext?: Record<string, unknown> },
  ) => Promise<{ message: string; status?: number; body?: unknown }>;
  skip: (reason: string, extraContext?: Record<string, unknown>) => Promise<void>;
}

export interface StepLogger {
  step(name: string, label: string, context?: Record<string, unknown>): Promise<StepHandle>;
  info(name: string, label: string, context?: Record<string, unknown>): Promise<void>;
  finalize(opts: { stoppedAtStep?: string | null; totalDurationMs: number }): Promise<void>;
  startedAt: number;
}

// Types are regenerated after the migration runs; use a permissive alias so this
// file compiles both before and after regeneration.
type StepsTable = {
  insert: (row: Record<string, unknown>) => {
    select: (c: string) => {
      maybeSingle: () => Promise<{
        data: { id: string } | null;
        error: { message: string } | null;
      }>;
    };
  };
  update: (row: Record<string, unknown>) => {
    eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
  };
};

function stepsTable(): StepsTable {
  return supabaseAdmin.from("automation_log_steps" as never) as unknown as StepsTable;
}

export function createStepLogger(logId: string | null, userId: string): StepLogger {
  const startedAt = Date.now();

  async function insertStep(row: {
    step: string;
    label: string;
    status: StepStatus;
    duration_ms?: number | null;
    error_message?: string | null;
    api_status_code?: number | null;
    api_response?: unknown;
    context?: Record<string, unknown> | null;
  }): Promise<string | null> {
    if (!logId) return null;
    const { data, error } = await stepsTable()
      .insert({
        log_id: logId,
        user_id: userId,
        step: row.step,
        label: row.label,
        status: row.status,
        duration_ms: row.duration_ms ?? null,
        error_message: row.error_message ?? null,
        api_status_code: row.api_status_code ?? null,
        api_response: row.api_response ?? null,
        context: row.context ?? null,
      })
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[step-logger] insert failed:", error.message);
      return null;
    }
    return data?.id ?? null;
  }

  async function updateStep(
    stepId: string,
    patch: {
      status: StepStatus;
      duration_ms: number;
      error_message?: string | null;
      api_status_code?: number | null;
      api_response?: unknown;
      context?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    const { error } = await stepsTable()
      .update({
        status: patch.status,
        duration_ms: patch.duration_ms,
        error_message: patch.error_message ?? null,
        api_status_code: patch.api_status_code ?? null,
        api_response: patch.api_response ?? null,
        context: patch.context ?? null,
      })
      .eq("id", stepId);
    if (error) console.error("[step-logger] update failed:", error.message);
  }

  return {
    startedAt,
    async info(name, label, context) {
      await insertStep({
        step: name,
        label,
        status: "success",
        duration_ms: 0,
        context: context ?? null,
      });
    },
    async step(name, label, context) {
      const stepStartedAt = Date.now();
      const stepId = await insertStep({
        step: name,
        label,
        status: "started",
        context: context ?? null,
      });

      const finish = async (
        status: StepStatus,
        extra: {
          error_message?: string | null;
          api_status_code?: number | null;
          api_response?: unknown;
          extraContext?: Record<string, unknown>;
        } = {},
      ) => {
        const duration_ms = Date.now() - stepStartedAt;
        const mergedContext = extra.extraContext
          ? { ...(context ?? {}), ...extra.extraContext }
          : (context ?? null);
        if (stepId) {
          await updateStep(stepId, {
            status,
            duration_ms,
            error_message: extra.error_message,
            api_status_code: extra.api_status_code,
            api_response: extra.api_response,
            context: mergedContext,
          });
        } else {
          await insertStep({
            step: name,
            label,
            status,
            duration_ms,
            error_message: extra.error_message,
            api_status_code: extra.api_status_code,
            api_response: extra.api_response,
            context: mergedContext,
          });
        }
      };

      return {
        success: async (opts) => {
          await finish("success", {
            api_response: opts?.apiResponse,
            api_status_code: opts?.apiStatus,
            extraContext: opts?.extraContext,
          });
        },
        fail: async (err, opts) => {
          const parsed = parseZernioError(err);
          await finish("failed", {
            error_message: parsed.message,
            api_status_code: parsed.status,
            api_response: parsed.body,
            extraContext: opts?.extraContext,
          });
          return parsed;
        },
        skip: async (reason, extraContext) => {
          await finish("skipped", { error_message: reason, extraContext });
        },
      };
    },
    async finalize({ stoppedAtStep, totalDurationMs }) {
      if (!logId) return;
      const logsTable = supabaseAdmin.from("automation_logs") as unknown as {
        update: (row: Record<string, unknown>) => {
          eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
        };
      };
      const { error } = await logsTable
        .update({
          stopped_at_step: stoppedAtStep ?? null,
          total_duration_ms: totalDurationMs,
          finished_at: new Date().toISOString(),
        })
        .eq("id", logId);
      if (error) console.error("[step-logger] finalize failed:", error.message);
    },
  };
}
