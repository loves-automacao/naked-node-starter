import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Send, TrendingUp, Bot, MessageCircle, Loader2 } from "lucide-react";
import { getDashboardStats } from "@/server/dashboard.functions";
import { withAuthFetch } from "@/lib/server-fetch";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_dashboard/dashboard")({
  component: DashboardPage,
});

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

function DashboardPage() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => withAuthFetch(() => getDashboardStats()),
  });

  const stats = [
    { title: "DMs Enviadas", value: data ? String(data.total_sent) : "—", icon: Send },
    {
      title: "Taxa de Sucesso",
      value: data?.success_rate == null ? "—" : `${data.success_rate.toFixed(1)}%`,
      icon: TrendingUp,
    },
    { title: "Automações Ativas", value: data ? String(data.active_automations) : "—", icon: Bot },
    { title: "Respostas Hoje", value: data ? String(data.replies_today) : "—", icon: MessageCircle },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{greeting()}{user?.email ? `, ${user.email.split("@")[0]}` : ""}</h1>
        <p className="mt-1 text-muted-foreground">Resumo das suas automações</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title} className="shadow-lg">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{stat.title}</CardTitle>
                <div className="rounded-lg bg-primary/10 p-2.5">
                  <Icon className="size-4 text-primary" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold tracking-tight">
                  {isLoading ? <Loader2 className="size-6 animate-spin text-muted-foreground" /> : stat.value}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
