import { useGetDashboardStats, useGetDashboardActivity, useHealthCheck } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Activity, CheckCircle2, ShieldAlert } from "lucide-react";
import { format } from "date-fns";
import { formatTokenAmount } from "../lib/format";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: activity, isLoading: activityLoading } = useGetDashboardActivity({ limit: 10 });
  const { data: health } = useHealthCheck();

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">System Overview</h1>
        <p className="text-muted-foreground mt-1">Live metrics from Arc Testnet contracts</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard title="Total Escrows" value={stats?.totalEscrows} loading={statsLoading} />
        <MetricCard title="Total Vesting" value={stats?.totalVestingSchedules} loading={statsLoading} />
        <MetricCard title="USDC Locked" value={stats ? `$${formatTokenAmount(stats.totalUsdcLocked)}` : undefined} loading={statsLoading} isCurrency />
        <MetricCard title="EURC Locked" value={stats ? `€${formatTokenAmount(stats.totalEurcLocked)}` : undefined} loading={statsLoading} isCurrency />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="col-span-2 bg-card/50 border-border">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest events across all modules</CardDescription>
          </CardHeader>
          <CardContent>
            {activityLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => <div key={i} className="h-12 bg-muted/50 rounded-md animate-pulse" />)}
              </div>
            ) : (
              <div className="space-y-4">
                {activity?.map((item) => (
                  <div key={item.id} className="flex items-start gap-4 p-3 rounded-lg hover:bg-accent/50 transition-colors border border-transparent hover:border-border">
                    <div className="p-2 bg-primary/10 text-primary rounded-md mt-0.5">
                      <Activity className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{item.description}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground font-mono">
                        <span>{format(new Date(item.timestamp), "HH:mm:ss")}</span>
                        <span>•</span>
                        <span className="truncate">{item.txHash}</span>
                      </div>
                    </div>
                  </div>
                ))}
                {!activity?.length && <div className="text-sm text-muted-foreground py-8 text-center">No recent activity</div>}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="bg-card/50 border-border">
            <CardHeader>
              <CardTitle>Network Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">API Health</span>
                {health?.status === "ok" ? (
                  <span className="text-sm text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> OK</span>
                ) : (
                  <span className="text-sm text-yellow-400 flex items-center gap-1"><ShieldAlert className="w-3 h-3" /> Degraded</span>
                )}
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Active Escrows</span>
                <span className="text-sm font-mono">{stats?.activeEscrows || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Disputed</span>
                <span className="text-sm font-mono text-destructive">{stats?.disputedEscrows || 0}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, loading, isCurrency }: { title: string, value?: string | number, loading: boolean, isCurrency?: boolean }) {
  return (
    <Card className="bg-card/50 border-border">
      <CardContent className="p-6">
        <p className="text-sm text-muted-foreground font-medium mb-2">{title}</p>
        {loading ? (
          <div className="h-8 w-24 bg-muted/50 rounded animate-pulse" />
        ) : (
          <p className={`text-3xl font-semibold tracking-tight ${isCurrency ? "font-mono" : ""}`}>
            {value}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
