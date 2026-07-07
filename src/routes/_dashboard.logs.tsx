import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle, MinusCircle, Loader2, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { listLogs } from "@/lib/logs.functions";
import { withAuthFetch } from "@/lib/server-fetch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LogTimeline } from "@/components/log-timeline";

export const Route = createFileRoute("/_dashboard/logs")({
  component: LogsPage,
});

function LogsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["logs"],
    queryFn: () => withAuthFetch(() => listLogs()),
  });

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("logs-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "automation_logs", filter: `user_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: ["logs"] })
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user, qc]);

  const logs = data?.logs ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Histórico em tempo real das execuções. Clique em um item pra ver a timeline detalhada. {logs.length} eventos recentes.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={isFetching ? "animate-spin" : ""} />
          Sincronizar
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && logs.length === 0 && (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          Nenhum log ainda. Quando uma automação disparar, aparecerá aqui.
        </div>
      )}

      {!isLoading && logs.length > 0 && (
        <div className="rounded-lg border border-border divide-y divide-border">
          {logs.map((log) => {
            const isOpen = expanded === log.id;
            return (
              <div key={log.id}>
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : log.id)}
                  className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
                >
                  <div className="mt-0.5">
                    {isOpen ? (
                      <ChevronDown className="size-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="mt-0.5">
                    {log.status === "sent" ? (
                      <CheckCircle2 className="size-4 text-emerald-500" />
                    ) : log.status === "failed" ? (
                      <XCircle className="size-4 text-destructive" />
                    ) : (
                      <MinusCircle className="size-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">@{log.instagram_user ?? "anônimo"}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {log.status}
                      </Badge>
                      {log.event_type && (
                        <Badge variant="outline" className="text-[10px]">
                          {log.event_type}
                        </Badge>
                      )}
                      {log.stopped_at_step && log.status === "failed" && (
                        <Badge variant="destructive" className="text-[10px]">
                          parou em: {log.stopped_at_step}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {new Date(log.created_at).toLocaleString("pt-BR")}
                      </span>
                      {log.total_duration_ms != null && (
                        <span className="text-[10px] text-muted-foreground">
                          {log.total_duration_ms < 1000
                            ? `${log.total_duration_ms}ms`
                            : `${(log.total_duration_ms / 1000).toFixed(2)}s`}
                        </span>
                      )}
                    </div>
                    {log.comment_text && (
                      <p className="text-xs text-muted-foreground mt-1 truncate">
                        💬 {log.comment_text}
                      </p>
                    )}
                    {log.error && !isOpen && (
                      <p className="text-xs text-destructive mt-1">⚠ {log.error}</p>
                    )}
                  </div>
                </button>
                {isOpen && user && (
                  <div className="bg-muted/20 px-4 py-4 border-t border-border">
                    <LogTimeline
                      logId={log.id}
                      userId={user.id}
                      headerMeta={{
                        event_type: log.event_type,
                        trigger_keyword: log.trigger_keyword,
                        stopped_at_step: log.stopped_at_step,
                        total_duration_ms: log.total_duration_ms,
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
