import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { statsApi } from "../api/stats";
import { apiRequest } from "../api/client";
import {
  Activity,
  Zap,
  Clock,
  ShieldAlert,
  Shield,
  ShieldCheck,
  Brain,
  Server,
  Eye,
  FileSearch,
  Gauge,
  Users,
} from "lucide-react";
import {
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  Cell,
} from "recharts";

interface AlertDailyStat {
  date: string;
  total: number;
  input_block: number;
  output_block: number;
  keyword: number;
  semantic: number;
}

interface AlertStats {
  daily: AlertDailyStat[];
  hourly: AlertDailyStat[];
  minute: AlertDailyStat[];
  granularity: string;
}

interface DailyStat { requests: number; input_tokens: number; output_tokens: number }
interface HourlyStat { requests: number; input_tokens: number; output_tokens: number }
interface MinuteStat { requests: number; input_tokens: number; output_tokens: number }

interface UsageStats {
  total_requests: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  success_requests: number;
  error_requests: number;
  success_rate: number;
  average_latency_ms: number;
  by_provider: Record<string, any>;
  by_model: Record<string, any>;
  tokens_by_provider: Record<string, any>;
  daily_breakdown: Record<string, DailyStat>;
  hourly_breakdown: Record<string, HourlyStat>;
  minute_breakdown: Record<string, MinuteStat>;
  granularity: string;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

const PROVIDER_TYPE_MAP: Record<string, string> = {
  openai: "OpenAI 兼容", anthropic: "Anthropic", deepseek: "DeepSeek",
  qwen: "通义千问", zhipu: "智谱", glm: "智谱", minimax: "MiniMax",
  siliconflow: "SiliconFlow", moonshot: "Moonshot", yi: "零一万物",
  openrouter: "OpenRouter", doubao: "火山引擎", arkcode: "Ark Code",
  gemini: "Google Gemini", openclaw: "OpenClaw",
};

function getProviderType(name: string): string {
  const lower = name.toLowerCase();
  for (const [key, val] of Object.entries(PROVIDER_TYPE_MAP)) {
    if (lower.includes(key)) return val;
  }
  return "OpenAI 兼容";
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [timeRange, setTimeRange] = useState<"10m" | "1h" | "1d" | "7d" | "30d">("1d");

  const periodMap: Record<string, number> = { "10m": 10, "1h": 60, "1d": 1440, "7d": 10080, "30d": 43200 };
  const period = periodMap[timeRange];

  const { data: usageStats } = useQuery({
    queryKey: ["usage-stats", period],
    queryFn: () => statsApi.usage(period) as any as UsageStats,
    refetchInterval: 10000, staleTime: 0,
  });

  const { data: alertStats } = useQuery({
    queryKey: ["alert-stats", period],
    queryFn: () => apiRequest<AlertStats>("GET", `/stats/alerts?period=${period}`),
    refetchInterval: 15000, staleTime: 0,
  });

  const { data: alertSeverityStats } = useQuery({
    queryKey: ["alert-severity-stats", period],
    queryFn: () => apiRequest<{ by_severity: Record<string, number> }>("GET", `/stats/alert-severity?period=${period}`),
    refetchInterval: 15000, staleTime: 0,
  });

  const { data: callerTop10 } = useQuery({
    queryKey: ["caller-top10", period],
    queryFn: () => apiRequest<{ callers: { api_key_used: string; client_ip: string; requests: number; input_tokens: number; output_tokens: number }[] }>("GET", `/stats/callers?period=${period}`),
    staleTime: 0, refetchInterval: 15000,
  });

  const { data: securityTokenStats } = useQuery({
    queryKey: ["security-token-stats", period],
    queryFn: () => apiRequest<{ total_checks: number; total_tokens: number; input_tokens: number; output_tokens: number; by_type: Record<string, number> }>("GET", `/stats/security-tokens?period=${period}`),
    staleTime: 0, refetchInterval: 15000,
  });

  const getCallerDisplayName = (apiKeyUsed: string): string => {
    const m: Record<string, string> = { behavior_analysis: "调用者行为分析", skills_detection: "Skills安全分析", agent_deep_check: "智能体安全深度分析", "security-semantic": "语义安全检测" };
    return m[apiKeyUsed] || apiKeyUsed;
  };

  const stats = usageStats || {
    total_requests: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0,
    success_requests: 0, error_requests: 0, success_rate: 0, average_latency_ms: 0,
    by_provider: {}, by_model: {}, tokens_by_provider: {},
    daily_breakdown: {} as Record<string, DailyStat>,
    hourly_breakdown: {} as Record<string, HourlyStat>,
    minute_breakdown: {} as Record<string, MinuteStat>,
  };

  const totalAlerts = alertStats?.daily?.reduce((s, d) => s + d.total, 0) ?? 0;
  const providerEntries = Object.entries(stats.by_provider || {}).sort((a: any, b: any) => (b[1]?.requests || 0) - (a[1]?.requests || 0));
  const topModels = Object.entries(stats.by_model || {}).sort((a: any, b: any) => (b[1]?.requests || 0) - (a[1]?.requests || 0)).slice(0, 10);
  const totalProviderCalls = providerEntries.reduce((s, [, d]: any) => s + (d.requests || 0), 0);
  const totalProviderTokens = providerEntries.reduce((s, [, d]: any) => s + (d.tokens || 0), 0);
  const avgProviderTokens = totalProviderCalls > 0 ? Math.round(totalProviderTokens / totalProviderCalls) : 0;
  const securityRatio = stats.total_tokens > 0 && securityTokenStats ? ((securityTokenStats.total_tokens / stats.total_tokens) * 100).toFixed(1) : "0.0";

  const securityStatus = totalAlerts === 0 ? "safe" : totalAlerts < 5 ? "warn" : "danger";

  const granularity = alertStats?.granularity || (timeRange === "10m" || timeRange === "1h" ? "minute" : timeRange === "1d" ? "hour" : "day");

  const chartData = React.useMemo(() => {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    if (granularity === "minute") {
      const minuteBreakdown = stats.minute_breakdown || {};
      const minuteAlerts = alertStats?.minute || [];
      const result = [];
      const totalMinutes = timeRange === "10m" ? 10 : 60;
      for (let m = totalMinutes - 1; m >= 0; m--) {
        const d = new Date(now.getTime() - m * 60000);
        const minuteKey = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        const matchingAlert = minuteAlerts.find((a) => a.date === minuteKey);
        result.push({ date: minuteKey, dateLabel: `${pad(d.getHours())}:${pad(d.getMinutes())}`, requests: minuteBreakdown[minuteKey]?.requests || 0, alerts: matchingAlert?.total || 0 });
      }
      return result;
    }
    if (granularity === "hour") {
      const hourlyBreakdown = stats.hourly_breakdown || {};
      const hourlyAlerts = alertStats?.hourly || [];
      const result = [];
      for (let h = 23; h >= 0; h--) {
        const d = new Date(now.getTime() - h * 3600000);
        const dateKey = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:00`;
        const matchingAlert = hourlyAlerts.find((a) => a.date === dateKey);
        result.push({ date: dateKey, dateLabel: `${pad(d.getHours())}:00`, requests: hourlyBreakdown[dateKey]?.requests || 0, alerts: matchingAlert?.total || 0 });
      }
      return result;
    }
    const dailyBreakdown = stats.daily_breakdown || {};
    const alertDaily = alertStats?.daily || [];
    const merged: Record<string, { date: string; requests: number; alerts: number }> = {};
    const daysCount = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 1;
    for (let i = daysCount - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const dateKey = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      merged[dateKey] = { date: dateKey, requests: dailyBreakdown[dateKey]?.requests || 0, alerts: 0 };
    }
    for (const alert of alertDaily) { if (merged[alert.date]) merged[alert.date].alerts = alert.total; }
    return Object.keys(merged).sort().map((d) => ({ date: d, dateLabel: d.slice(5), requests: merged[d].requests, alerts: merged[d].alerts }));
  }, [granularity, timeRange, alertStats, stats.minute_breakdown, stats.hourly_breakdown, stats.daily_breakdown]);

  const xAxisInterval = timeRange === "1h" ? 4 : timeRange === "1d" ? 3 : timeRange === "30d" ? 2 : 0;

  const quickActions = [
    { icon: Eye, label: "调用者分析", desc: "分析API调用行为", href: "/security-square", color: "from-violet-500/20 to-purple-500/10", iconColor: "text-violet-400", border: "border-violet-500/20" },
    { icon: FileSearch, label: "Skills检测", desc: "检测文档注入风险", href: "/security-square", color: "from-amber-500/20 to-yellow-500/10", iconColor: "text-amber-400", border: "border-amber-500/20" },
    { icon: Shield, label: "安全防护", desc: "配置内容过滤规则", href: "/security", color: "from-primary/20 to-primary/5", iconColor: "text-primary", border: "border-primary/20" },
    { icon: Gauge, label: "流量控制", desc: "模型限流与配额", href: "/rate-limit", color: "from-emerald-500/20 to-green-500/10", iconColor: "text-emerald-400", border: "border-emerald-500/20" },
  ];

  return (
    <div className="space-y-6">
      {/* Hero: Security Status Shield */}
      <div className="flex items-center gap-8 bg-card rounded-2xl p-8 border border-border">
        <div className={`relative w-32 h-32 rounded-full flex items-center justify-center shadow-2xl shrink-0 ${
          securityStatus === "safe" ? "bg-gradient-to-br from-emerald-500 to-cyan-500 shadow-emerald-500/30" :
          securityStatus === "warn" ? "bg-gradient-to-br from-amber-500 to-yellow-500 shadow-amber-500/30" :
          "bg-gradient-to-br from-red-500 to-rose-500 shadow-red-500/30"
        }`}>
          <div className="absolute inset-1 rounded-full bg-card flex items-center justify-center">
            {securityStatus === "safe" ? (
              <ShieldCheck size={48} className="text-emerald-400" />
            ) : (
              <ShieldAlert size={48} className={securityStatus === "warn" ? "text-amber-400" : "text-red-400"} />
            )}
          </div>
        </div>
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-foreground">
            {securityStatus === "safe" ? "安全防护正常" : securityStatus === "warn" ? "发现少量告警" : "存在安全风险"}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {securityStatus === "safe" ? "当前时段未检测到安全告警，所有防护策略运行正常" : `当前时段累计 ${totalAlerts} 条安全告警`}
          </p>
          <div className="flex gap-6 mt-4">
            <div>
              <p className="text-2xl font-bold text-foreground">{stats.total_requests.toLocaleString()}</p>
              <p className="text-[11px] text-muted-foreground">总请求</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{formatTokens(stats.total_tokens)}</p>
              <p className="text-[11px] text-muted-foreground">Token 用量</p>
            </div>
            <div>
              <p className={`text-2xl font-bold ${stats.success_rate >= 95 ? "text-emerald-400" : stats.success_rate > 0 ? "text-amber-400" : "text-muted-foreground"}`}>
                {stats.success_rate.toFixed(1)}%
              </p>
              <p className="text-[11px] text-muted-foreground">成功率</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{stats.average_latency_ms.toFixed(0)}<span className="text-sm text-muted-foreground">ms</span></p>
              <p className="text-[11px] text-muted-foreground">平均延迟</p>
            </div>
          </div>
          {alertSeverityStats?.by_severity && Object.keys(alertSeverityStats.by_severity).length > 0 && (
            <div className="flex gap-2 mt-3">
              {(["critical", "high", "medium", "low"] as const).map((sev) => {
                const count = alertSeverityStats.by_severity[sev] || 0;
                if (count === 0) return null;
                const colorMap: Record<string, string> = {
                  critical: "bg-red-500/10 text-red-400 border-red-500/30",
                  high: "bg-orange-500/10 text-orange-400 border-orange-500/30",
                  medium: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
                  low: "bg-green-500/10 text-green-400 border-green-500/30",
                };
                const labelMap: Record<string, string> = { critical: "严重", high: "高危", medium: "中危", low: "低危" };
                return (
                  <div key={sev} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border ${colorMap[sev]}`}>
                    <span>{labelMap[sev]}</span>
                    <span className="font-bold">{count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex gap-1 self-start">
          {(["10m", "1h", "1d", "7d", "30d"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setTimeRange(r)}
              className={`px-2.5 py-1 text-[11px] rounded-md transition-colors ${
                timeRange === r ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              {r === "10m" ? "10分钟" : r === "1h" ? "1小时" : r === "1d" ? "1天" : r === "7d" ? "7天" : "30天"}
            </button>
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-4 gap-4">
        {quickActions.map((action) => (
          <button
            key={action.label}
            onClick={() => navigate(action.href)}
            className={`bg-gradient-to-br ${action.color} border ${action.border} rounded-xl p-5 text-left transition-all hover:scale-[1.02] hover:shadow-lg group`}
          >
            <action.icon size={28} className={`${action.iconColor} mb-3 group-hover:scale-110 transition-transform`} />
            <p className="text-sm font-semibold text-foreground">{action.label}</p>
            <p className="text-[11px] text-muted-foreground mt-1">{action.desc}</p>
          </button>
        ))}
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="bg-card rounded-xl p-6 border border-border">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="text-primary w-4 h-4" />
            <h3 className="text-sm font-semibold text-foreground">请求趋势 & 安全告警</h3>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="dateLabel" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} interval={xAxisInterval} />
              <YAxis yAxisId="left" orientation="left" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "0.75rem", color: "hsl(var(--foreground))", fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }} />
              <Bar yAxisId="right" dataKey="alerts" name="告警数" fill="#ef4444" radius={[2, 2, 0, 0]} maxBarSize={40}>
                {chartData.map((_, index) => (<Cell key={`cell-${index}`} />))}
              </Bar>
              <Line yAxisId="left" type="monotone" dataKey="requests" name="请求数" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3, fill: "hsl(var(--primary))" }} activeDot={{ r: 5 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Provider Usage */}
      <div className="bg-card rounded-xl p-6 border border-border">
        <div className="flex items-center gap-2 mb-4">
          <Server className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">提供商用量</h3>
        </div>
        {providerEntries.length > 0 ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-secondary rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-foreground">{totalProviderCalls}</p>
                <p className="text-[11px] text-muted-foreground">总调用</p>
              </div>
              <div className="bg-secondary rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-foreground">{formatTokens(totalProviderTokens)}</p>
                <p className="text-[11px] text-muted-foreground">总 Tokens</p>
              </div>
              <div className="bg-secondary rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-foreground">{formatTokens(avgProviderTokens)}</p>
                <p className="text-[11px] text-muted-foreground">平均 Tokens/次</p>
              </div>
            </div>
            <div className="divide-y divide-border">
              <div className="grid grid-cols-[1fr_1fr_100px_100px_100px] gap-2 px-3 py-2 text-[11px] text-muted-foreground font-medium">
                <span>提供商</span><span>类型</span><span className="text-right">调用</span><span className="text-right">Tokens</span><span className="text-right">成功率</span>
              </div>
              {providerEntries.map(([name, data]: [string, any]) => (
                <div key={name} className="grid grid-cols-[1fr_1fr_100px_100px_100px] gap-2 px-3 py-2 items-center">
                  <span className="text-sm text-foreground truncate">{name}</span>
                  <span className="text-[11px] text-muted-foreground">{getProviderType(name)}</span>
                  <span className="text-sm text-foreground text-right">{(data.requests || 0).toLocaleString()}</span>
                  <span className="text-sm text-foreground text-right">{formatTokens(data.tokens || 0)}</span>
                  <span className="text-sm text-foreground text-right">{((data.success_rate || 0) * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-center py-8 text-sm">暂无调用数据</p>
        )}
      </div>

      {/* Security Token + Top Models */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl p-6 border border-border">
          <div className="flex items-center gap-2 mb-4">
            <Brain className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-semibold text-foreground">安全分析消耗</h3>
            <span className="ml-auto text-[11px] text-muted-foreground">占比 {securityRatio}%</span>
          </div>
          {securityTokenStats && securityTokenStats.total_checks > 0 ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-secondary rounded-lg p-2.5 text-center">
                  <p className="text-lg font-bold text-foreground">{securityTokenStats.total_checks}</p>
                  <p className="text-[10px] text-muted-foreground">分析次数</p>
                </div>
                <div className="bg-secondary rounded-lg p-2.5 text-center">
                  <p className="text-lg font-bold text-foreground">{formatTokens(securityTokenStats.total_tokens)}</p>
                  <p className="text-[10px] text-muted-foreground">Tokens</p>
                </div>
                <div className="bg-secondary rounded-lg p-2.5 text-center">
                  <p className="text-lg font-bold text-foreground">{formatTokens(Math.round(securityTokenStats.total_tokens / securityTokenStats.total_checks))}</p>
                  <p className="text-[10px] text-muted-foreground">平均/次</p>
                </div>
              </div>
              <div className="space-y-1.5">
                {Object.entries(securityTokenStats.by_type || {}).map(([type, tokens]) => {
                  const maxTokens = Math.max(...Object.values(securityTokenStats.by_type || {}));
                  const pct = maxTokens > 0 ? ((tokens as number) / maxTokens) * 100 : 0;
                  return (
                    <div key={type} className="flex items-center gap-3">
                      <span className="text-[11px] text-muted-foreground w-24 shrink-0 truncate">
                        {type === "user_profile" || type === "user_profile_task" ? "行为分析" : type === "skills_detection" ? "Skills检测" : type === "security_check" ? "语义检测" : type === "agent_deep_check" ? "智能体分析" : type}
                      </span>
                      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-purple-500 to-violet-400 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] text-muted-foreground shrink-0">{formatTokens(tokens as number)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8 text-sm">暂无安全分析数据</p>
          )}
        </div>

        <div className="bg-card rounded-xl p-6 border border-border">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-foreground">模型调用 TOP 10</h3>
          </div>
          {topModels.length > 0 ? (
            <div className="space-y-1">
              {topModels.map(([model, data]: [string, any], i: number) => {
                const maxReq = (topModels[0][1] as any)?.requests || 1;
                const pct = ((data.requests || 0) / maxReq) * 100;
                return (
                  <div key={model} className="flex items-center gap-2 py-1.5">
                    <span className="text-[11px] text-muted-foreground w-5 shrink-0 text-right">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <p className="text-xs text-foreground truncate font-mono">{model}</p>
                        <span className="text-[11px] text-muted-foreground shrink-0 ml-2">{(data.requests || 0).toLocaleString()}</span>
                      </div>
                      <div className="h-1 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-emerald-500/60 to-cyan-400/40 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8 text-sm">暂无调用数据</p>
          )}
        </div>
      </div>

      {/* Caller Top 10 */}
      {callerTop10?.callers && callerTop10.callers.length > 0 && (
        <div className="bg-card rounded-xl p-6 border border-border">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-foreground">调用者 TOP 10</h3>
          </div>
          <div className="grid grid-cols-2 gap-x-6">
            {callerTop10.callers.slice(0, 10).map((c, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] text-muted-foreground w-5 shrink-0">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-xs text-foreground truncate font-mono">{getCallerDisplayName(c.api_key_used)}</p>
                    <p className="text-[10px] text-muted-foreground">{c.client_ip}</p>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground shrink-0 ml-3">{c.requests} 次</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
