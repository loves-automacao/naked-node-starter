import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle, MinusCircle, Loader2, Copy } from "lucide-react";
import { getLogSteps } from "@/lib/logs.functions";
import { withAuthFetch } from "@/lib/server-fetch";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface LogTimelineProps {
  logId: string;
  userId: string;
  headerMeta?: {
    event_type?: string | null;
    trigger_keyword?: string | null;
    stopped_at_step?: string | null;
    total_duration_ms?: number | null;
  };
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("pt-BR", { hour12: false });
}

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "success") return <CheckCircle2 className="size-4 text-emerald-500" />;
  if (status === "failed") return <XCircle className="size-4 text-destructive" />;
  if (status === "skipped") return <MinusCircle className="size-4 text-amber-500" />;
  return <Loader2 className="size-4 text-muted-foreground animate-spin" />;
}

export function LogTimeline({ logId, userId, headerMeta }: LogTimelineProps) {
  const qc = useQueryClient();
  const queryKey = useMemo(() => ["log-steps", logId], [logId]);

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => withAuthFetch(() => getLogSteps({ data: { logId } })),
  });

  useEffect(() => {
    const ch = supabase
      .channel(`log-steps-${logId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "automation_log_steps",
          filter: `log_id=eq.${logId}`,
        },
        () => qc.invalidateQueries({ queryKey })
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [logId, userId, qc, queryKey]);

  const steps = data?.steps ?? [];

  const copyDiagnostics = () => {
    const lines = steps.map((s) => {
      const parts = [
        fmtTime(s.created_at),
        s.status.toUpperCase().padEnd(8),
        s.label,
        s.duration_ms != null ? `(${fmtMs(s.duration_ms)})` : "",
        s.error_message ? `— ${s.error_message}` : "",
        s.api_status_code ? `[HTTP ${s.api_status_code}]` : "",
      ];
      return parts.filter(Boolean).join(" ");
    });
    const header = `Log ${logId}\n${headerMeta?.event_type ?? ""}${
      headerMeta?.trigger_keyword ? ` · keyword=${headerMeta.trigger_keyword}` : ""
    }${headerMeta?.stopped_at_step ? ` · parou em: ${headerMeta.stopped_at_step}` : ""}\n\n`;
    navigator.clipboard.writeText(header + lines.join("\n"));
    toast.success("Diagnóstico copiado");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (steps.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center">
        Sem etapas registradas.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {headerMeta?.event_type && (
            <Badge variant="outline" className="text-[10px]">
              {headerMeta.event_type}
            </Badge>
          )}
          {headerMeta?.trigger_keyword && (
            <Badge variant="outline" className="text-[10px]">
              keyword: {headerMeta.trigger_keyword}
            </Badge>
          )}
          {headerMeta?.stopped_at_step && (
            <Badge variant="destructive" className="text-[10px]">
              parou em: {headerMeta.stopped_at_step}
            </Badge>
          )}
          {headerMeta?.total_duration_ms != null && (
            <span>total {fmtMs(headerMeta.total_duration_ms)}</span>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={copyDiagnostics}>
          <Copy className="size-3" />
          Copiar diagnóstico
        </Button>
      </div>

      <ol className="relative border-l border-border ml-2 space-y-3">
        {steps.map((s) => {
          const failed = s.status === "failed";
          const skipped = s.status === "skipped";
          return (
            <li key={s.id} className="ml-4">
              <span className="absolute -left-[9px] flex size-4 items-center justify-center rounded-full bg-background">
                <StatusIcon status={s.status} />
              </span>
              <div
                className={`rounded-md border px-3 py-2 ${
                  failed
                    ? "border-destructive/40 bg-destructive/5"
                    : skipped
                      ? "border-amber-500/40 bg-amber-500/5"
                      : "border-border"
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-muted-foreground">
                    {fmtTime(s.created_at)}
                  </span>
                  <span className="text-sm">{s.label}</span>
                  {s.duration_ms != null && s.duration_ms > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      {fmtMs(s.duration_ms)}
                    </span>
                  )}
                  {s.api_status_code != null && (
                    <Badge variant={failed ? "destructive" : "outline"} className="text-[10px]">
                      HTTP {s.api_status_code}
                    </Badge>
                  )}
                </div>
                {s.error_message && (
                  <div className="mt-1 text-xs text-destructive">⚠ {s.error_message}</div>
                )}
                {(s.api_response || s.context) && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
                      Detalhes
                    </summary>
                    {s.api_response != null && (
                      <pre className="mt-1 text-[10px] bg-muted/40 rounded p-2 overflow-x-auto max-h-40">
                        {typeof s.api_response === "string"
                          ? s.api_response
                          : JSON.stringify(s.api_response, null, 2)}
                      </pre>
                    )}
                    {s.context && (
                      <pre className="mt-1 text-[10px] bg-muted/40 rounded p-2 overflow-x-auto max-h-40">
                        {JSON.stringify(s.context, null, 2)}
                      </pre>
                    )}
                  </details>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
