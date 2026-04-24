import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/tauri";
import {
  Activity,
  Zap,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  FolderOpen,
  ShieldAlert,
  Users,
  Brain,
} from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  Cell,
  LabelList,
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

interface DailyStat {
  requests: number;
  input_tokens: number;
  output_tokens: number;
}

interface HourlyStat {
  requests: number;
  input_tokens: number;
  output_tokens: number;
}

interface MinuteStat {
  requests: number;
  input_tokens: number;
  output_tokens: number;
}

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

function StatsCard({
  title,
  value,
  icon,
  description,
  trend,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  description?: string;
  trend?: "up" | "down" | "neutral";
}) {
  return (
    <div className="bg-card rounded-lg p-6 border border-border">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-3xl font-bold mt-2">{value}</p>
          {description && (
            <p
              className={`text-sm mt-2 flex items-center gap-1 ${
                trend === "up"
                  ? "text-green-500"
                  : trend === "down"
                    ? "text-red-500"
                    : "text-muted-foreground"
              }`}
            >
              {trend === "up" && <ArrowUpRight size={14} />}
              {trend === "down" && <ArrowDownRight size={14} />}
              {description}
            </p>
          )}
        </div>
        <div className="text-primary opacity-80">{icon}</div>
      </div>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

export default function Dashboard() {
  const [timeRange, setTimeRange] = useState<
    "10m" | "1h" | "1d" | "7d" | "30d"
  >("1d");

  const periodMap: Record<string, number> = {
    "10m": 10,
    "1h": 60,
    "1d": 60 * 24,
    "7d": 60 * 24 * 7,
    "30d": 60 * 24 * 30,
  };
  const period = periodMap[timeRange];

  const { data: usageStats } = useQuery({
    queryKey: ["usage-stats", period],
    queryFn: () => invoke<UsageStats>("get_usage_stats", { period }),
    refetchInterval: 10000,
    staleTime: 0,
  });

  const { data: alertStats } = useQuery({
    queryKey: ["alert-stats", period],
    queryFn: () => invoke<AlertStats>("get_alert_stats", { period }),
    refetchInterval: 15000,
    staleTime: 0,
  });

  const { data: callerTop10 } = useQuery({
    queryKey: ["caller-top10", period],
    queryFn: async () => {
      const raw = await invoke<string>("get_caller_top10", { period });
      return JSON.parse(raw) as {
        callers: {
          api_key_used: string;
          client_ip: string;
          requests: number;
          input_tokens: number;
          output_tokens: number;
        }[];
      };
    },
    staleTime: 0,
    refetchInterval: 15000,
  });

  const { data: securityTokenStats } = useQuery({
    queryKey: ["security-token-stats", period],
    queryFn: async () => {
      const raw = await invoke<string>("get_security_token_stats", { period });
      return JSON.parse(raw) as {
        total_checks: number;
        total_tokens: number;
        input_tokens: number;
        output_tokens: number;
        by_type: Record<string, number>;
      };
    },
    staleTime: 0,
    refetchInterval: 15000,
  });

  const stats = usageStats || {
    total_requests: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    success_requests: 0,
    error_requests: 0,
    success_rate: 0,
    average_latency_ms: 0,
    by_provider: {},
    by_model: {},
    tokens_by_provider: {},
    daily_breakdown: {} as Record<string, DailyStat>,
    hourly_breakdown: {} as Record<string, HourlyStat>,
    minute_breakdown: {} as Record<string, MinuteStat>,
  };

  const providerEntries = Object.entries(stats.by_provider || {});
  const topModels = Object.entries(stats.by_model || {})
    .sort((a: any, b: any) => (b[1]?.requests || 0) - (a[1]?.requests || 0))
    .slice(0, 10);

  const granularity =
    alertStats?.granularity ||
    (timeRange === "10m" || timeRange === "1h"
      ? "minute"
      : timeRange === "1d"
        ? "hour"
        : "day");

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
        const minuteKey =
          d.getFullYear() +
          "-" +
          pad(d.getMonth() + 1) +
          "-" +
          pad(d.getDate()) +
          " " +
          pad(d.getHours()) +
          ":" +
          pad(d.getMinutes());
        const minuteStr = pad(d.getHours()) + ":" + pad(d.getMinutes());
        const matchingAlert = minuteAlerts.find((a) => a.date === minuteKey);
        result.push({
          date: minuteKey,
          dateLabel: minuteStr,
          requests: minuteBreakdown[minuteKey]?.requests || 0,
          alerts: matchingAlert?.total || 0,
        });
      }
      return result;
    }

    if (granularity === "hour") {
      const hourlyBreakdown = stats.hourly_breakdown || {};
      const hourlyAlerts = alertStats?.hourly || [];
      const result = [];

      for (let h = 23; h >= 0; h--) {
        const d = new Date(now.getTime() - h * 3600000);
        const dateKey =
          d.getFullYear() +
          "-" +
          pad(d.getMonth() + 1) +
          "-" +
          pad(d.getDate()) +
          " " +
          pad(d.getHours()) +
          ":00";
        const hourStr = pad(d.getHours()) + ":00";
        const matchingAlert = hourlyAlerts.find((a) => a.date === dateKey);
        result.push({
          date: dateKey,
          dateLabel: hourStr,
          requests: hourlyBreakdown[dateKey]?.requests || 0,
          alerts: matchingAlert?.total || 0,
        });
      }
      return result;
    }

    const dailyBreakdown = stats.daily_breakdown || {};
    const alertDaily = alertStats?.daily || [];
    const merged: Record<
      string,
      { date: string; requests: number; alerts: number }
    > = {};

    const daysCount = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 1;
    for (let i = daysCount - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const dateKey =
        d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      merged[dateKey] = {
        date: dateKey,
        requests: dailyBreakdown[dateKey]?.requests || 0,
        alerts: 0,
      };
    }

    for (const alert of alertDaily) {
      if (merged[alert.date]) {
        merged[alert.date].alerts = alert.total;
      }
    }

    const sortedDates = Object.keys(merged).sort();
    return sortedDates.map((d) => ({
      date: d,
      dateLabel: d.slice(5),
      requests: merged[d].requests,
      alerts: merged[d].alerts,
    }));
  }, [
    granularity,
    timeRange,
    alertStats,
    stats.minute_breakdown,
    stats.hourly_breakdown,
    stats.daily_breakdown,
  ]);

  const xAxisInterval =
    timeRange === "1h"
      ? 4
      : timeRange === "1d"
        ? 3
        : timeRange === "30d"
          ? 2
          : 0;
  const xAxisFontSize = timeRange === "1d" ? 10 : timeRange === "30d" ? 9 : 12;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">仪表盘</h1>
          <p className="text-muted-foreground mt-2">ClamAI 运行概览</p>
        </div>
        <div className="flex gap-1 mt-2">
          {(["10m", "1h", "1d", "7d", "30d"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setTimeRange(r)}
              className={`px-3 py-1 text-xs rounded ${
                timeRange === r
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {r === "10m"
                ? "10分钟"
                : r === "1h"
                  ? "1小时"
                  : r === "1d"
                    ? "1天"
                    : r === "7d"
                      ? "7天"
                      : "30天"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatsCard
          title="总请求数"
          value={stats.total_requests}
          icon={<Activity className="w-6 h-6" />}
          description={`成功 ${stats.success_requests} · 失败 ${stats.error_requests}`}
          trend={stats.error_requests > 0 ? "down" : "neutral"}
        />
        <StatsCard
          title="Token 用量"
          value={formatTokens(stats.total_tokens)}
          icon={<Zap className="w-6 h-6" />}
          description={`输入 ${formatTokens(stats.input_tokens)} · 输出 ${formatTokens(stats.output_tokens)}`}
        />
        <StatsCard
          title="平均延迟"
          value={`${stats.average_latency_ms.toFixed(2)}ms`}
          icon={<Clock className="w-6 h-6" />}
          description={`成功率 ${stats.success_rate.toFixed(1)}%`}
          trend={
            stats.success_rate >= 95
              ? "up"
              : stats.success_rate > 0
                ? "down"
                : "neutral"
          }
        />
        <StatsCard
          title="安全告警"
          value={alertStats?.daily?.reduce((s, d) => s + d.total, 0) ?? 0}
          icon={<ShieldAlert className="w-6 h-6 text-destructive" />}
          description={`共 ${alertStats?.daily?.length ?? 0} 天有告警记录`}
        />
      </div>

      {chartData.length > 0 && (
        <div className="bg-card rounded-lg p-6 border border-border">
          <div className="flex items-center gap-2 mb-4">
            <ShieldAlert className="text-destructive w-5 h-5" />
            <h3 className="text-lg font-semibold">告警趋势 & 模型调用</h3>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart
              data={chartData}
              margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="dateLabel"
                tick={{
                  fill: "var(--muted-foreground)",
                  fontSize: xAxisFontSize,
                }}
                interval={xAxisInterval}
              />
              <YAxis
                yAxisId="left"
                orientation="left"
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "0.5rem",
                  color: "var(--foreground)",
                }}
              />
              <Legend />
              <Bar
                yAxisId="right"
                dataKey="alerts"
                name="告警数"
                fill="#ef4444"
                radius={[2, 2, 0, 0]}
                maxBarSize={40}
              >
                {chartData.map((_, index) => (
                  <Cell key={`cell-${index}`} />
                ))}
                <LabelList
                  dataKey="alerts"
                  position="top"
                  style={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                />
              </Bar>
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="requests"
                name="请求数"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ r: 3, fill: "#3b82f6" }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-lg p-6 border border-border">
          <h3 className="text-lg font-semibold mb-4">提供商用量</h3>
          {providerEntries.length > 0 ? (
            <div className="space-y-3">
              {providerEntries.map(([name, data]: [string, any]) => (
                <div key={name} className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{name}</p>
                    <p className="text-xs text-muted-foreground">
                      {data.requests || 0} 次请求
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">
                      {formatTokens(data.tokens || 0)} tokens
                    </p>
                    <p className="text-xs text-muted-foreground">
                      成功率 {((data.success_rate || 0) * 100).toFixed(1)}%
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              暂无调用数据
            </p>
          )}
        </div>

        <div className="bg-card rounded-lg p-6 border border-border">
          <h3 className="text-lg font-semibold mb-4">热门模型 TOP 10</h3>
          {topModels.length > 0 ? (
            <div className="space-y-3">
              {topModels.map(([model, data]: [string, any], i: number) => (
                <div key={model} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-6">
                      {i + 1}.
                    </span>
                    <p className="font-mono text-sm">{model}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-sm">{data.requests || 0} 次</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {formatTokens(data.tokens || 0)} tokens
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              暂无调用数据
            </p>
          )}
        </div>
      </div>

      {Object.keys(stats.tokens_by_provider || {}).length > 0 && (
        <div className="bg-card rounded-lg p-6 border border-border">
          <h3 className="text-lg font-semibold mb-4">Token 分布详情</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(stats.tokens_by_provider).map(
              ([name, data]: [string, any]) => (
                <div
                  key={name}
                  className="bg-background rounded-lg p-4 border border-border"
                >
                  <h4 className="font-semibold mb-2">{name}</h4>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">输入 Tokens</span>
                      <span>{formatTokens(data.input_tokens || 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">输出 Tokens</span>
                      <span>{formatTokens(data.output_tokens || 0)}</span>
                    </div>
                    <div className="flex justify-between font-medium pt-1 border-t border-border">
                      <span>合计</span>
                      <span>
                        {formatTokens(
                          (data.input_tokens || 0) + (data.output_tokens || 0),
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              ),
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-lg p-6 border border-border">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-5 h-5 text-blue-400" />
            <h3 className="text-lg font-semibold">调用者 TOP 10 (Key-IP)</h3>
          </div>
          {callerTop10?.callers && callerTop10.callers.length > 0 ? (
            <div className="space-y-2">
              {callerTop10.callers.map((c, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-1.5 border-b border-border last:border-0"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-xs text-muted-foreground w-6 shrink-0">
                      {i + 1}.
                    </span>
                    <div className="min-w-0">
                      <p className="font-mono text-sm truncate">
                        {c.api_key_used}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {c.client_ip}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <span className="text-sm font-medium">{c.requests} 次</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {formatTokens(c.input_tokens + c.output_tokens)} tok
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              暂无调用者数据
            </p>
          )}
        </div>

        <div className="bg-card rounded-lg p-6 border border-border">
          <div className="flex items-center gap-2 mb-4">
            <Brain className="w-5 h-5 text-purple-400" />
            <h3 className="text-lg font-semibold">安全分析 Token 消耗</h3>
          </div>
          {securityTokenStats && securityTokenStats.total_checks > 0 ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-background rounded-lg p-3 border border-border text-center">
                  <p className="text-2xl font-bold">
                    {securityTokenStats.total_checks}
                  </p>
                  <p className="text-xs text-muted-foreground">分析次数</p>
                </div>
                <div className="bg-background rounded-lg p-3 border border-border text-center">
                  <p className="text-2xl font-bold">
                    {formatTokens(securityTokenStats.total_tokens)}
                  </p>
                  <p className="text-xs text-muted-foreground">总 Token</p>
                </div>
                <div className="bg-background rounded-lg p-3 border border-border text-center">
                  <p className="text-2xl font-bold">
                    {securityTokenStats.total_checks > 0
                      ? formatTokens(
                          Math.round(
                            securityTokenStats.total_tokens /
                              securityTokenStats.total_checks,
                          ),
                        )
                      : 0}
                  </p>
                  <p className="text-xs text-muted-foreground">平均 Token/次</p>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">按分析类型分布</p>
                {Object.entries(securityTokenStats.by_type || {}).map(
                  ([type, tokens]) => (
                    <div
                      key={type}
                      className="flex items-center justify-between"
                    >
                      <span className="text-sm">
                        {type === "user_profile"
                          ? "调用者画像"
                          : type === "user_profile_task"
                            ? "行为分析任务"
                            : type === "skills_detection"
                              ? "Skills 检测"
                              : type === "security_check"
                                ? "安全语义检测"
                                : type}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {formatTokens(tokens)} tokens
                      </span>
                    </div>
                  ),
                )}
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              暂无安全分析数据
            </p>
          )}
        </div>
      </div>

      <div className="bg-card rounded-lg p-6 border border-border">
        <h3 className="text-lg font-semibold mb-4">快速操作</h3>
        <div className="flex gap-4">
          <button
            onClick={() => invoke("open_log_folder")}
            className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/90"
          >
            <FolderOpen className="w-4 h-4" />
            打开日志目录
          </button>
        </div>
      </div>
    </div>
  );
}
