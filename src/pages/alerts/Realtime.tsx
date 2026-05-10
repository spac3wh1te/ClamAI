import { useQuery } from "@tanstack/react-query";
import SecurityAlerts from "../SecurityAlerts";
import { securityApi } from "../../api/security";
import { apiRequest } from "../../api/client";
import {
  ShieldAlert, ShieldCheck, ShieldOff, Activity,
  Bell, Zap, Clock, Eye, Shield,
} from "lucide-react";

function StatCard({ icon: Icon, label, value, sub, color }: { icon: React.ElementType; label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className="bg-card rounded-lg border border-border p-4 flex items-start gap-3">
      <div className={`p-2 rounded-lg ${color}`}>
        <Icon size={18} />
      </div>
      <div>
        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{label}</p>
        <p className="text-xl font-bold mt-0.5">{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function AlertRealtime() {
  const { data: config } = useQuery({
    queryKey: ["security-config"],
    queryFn: () => securityApi.getConfig(),
    staleTime: 10000,
  });

  const { data: statsData } = useQuery({
    queryKey: ["security-stats", "content"],
    queryFn: () => securityApi.getStats("content") as unknown as Promise<{ total: number; unresolved: number; today: number; hour24: number }>,
    staleTime: 5000,
    refetchInterval: 10000,
  });

  const { data: alertSeverity } = useQuery({
    queryKey: ["realtime-alert-severity"],
    queryFn: () => apiRequest<{ by_severity: Record<string, number> }>("GET", "/stats/alert-severity?period=1440"),
    staleTime: 0,
    refetchInterval: 15000,
  });

  const inputEnabled = config?.input?.enabled ?? false;
  const outputEnabled = config?.output?.enabled ?? false;
  const inputMode = config?.input?.mode ?? "detect";
  const outputMode = config?.output?.mode ?? "detect";
  const severityDist = alertSeverity?.by_severity || {};
  const criticalCount = severityDist.critical || 0;
  const highCount = severityDist.high || 0;
  const mediumCount = severityDist.medium || 0;
  const lowCount = severityDist.low || 0;

  const engineStatus = inputEnabled || outputEnabled;
  const modeLabel = (inputMode === "block" || outputMode === "block") ? "拦截模式" : "检测模式";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center border border-red-500/20">
          <ShieldAlert size={20} className="text-red-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">实时防护</h1>
          <p className="text-sm text-muted-foreground mt-1">安全事件的告警及拦截情况展示</p>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-3">
        <StatCard
          icon={engineStatus ? Activity : ShieldOff}
          label="防护引擎"
          value={engineStatus ? "运行中" : "已停止"}
          sub={inputEnabled ? `输入: ${inputMode === "block" ? "拦截" : "检测"}` : "输入: 关闭"}
          color={engineStatus ? "bg-emerald-500/10 text-emerald-400" : "bg-muted text-muted-foreground"}
        />
        <StatCard
          icon={Bell}
          label="总告警数"
          value={statsData?.total ?? "-"}
          sub={`未处理 ${statsData?.unresolved ?? 0}`}
          color="bg-red-500/10 text-red-400"
        />
        <StatCard
          icon={Zap}
          label="严重+高危"
          value={criticalCount + highCount}
          sub={`严重 ${criticalCount} · 高危 ${highCount}`}
          color="bg-orange-500/10 text-orange-400"
        />
        <StatCard
          icon={Clock}
          label="今日新增"
          value={statsData?.today ?? "-"}
          sub={`近24h: ${statsData?.hour24 ?? "-"}`}
          color="bg-amber-500/10 text-amber-400"
        />
        <StatCard
          icon={Eye}
          label="检测能力"
          value={outputEnabled ? "双向" : inputEnabled ? "仅输入" : "未启用"}
          sub={
            [
              config?.input?.semantic_enabled && "语义",
              config?.input?.keyword_enabled && "关键词",
              config?.input?.vector_enabled && "向量",
            ].filter(Boolean).join(" + ") || "无"
          }
          color="bg-blue-500/10 text-blue-400"
        />
      </div>

      <SecurityAlerts hideHeader defaultSource="content" />
    </div>
  );
}
