import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { systemAnalysisApi, type SystemAnalysisTask, type KeyResult, type SystemAnalysisHistory, type ThreatSignal } from "../../api/analysis";
import { apiRequest } from "../../api/client";
import {
  Activity, ShieldAlert, Play, RefreshCw, Clock, AlertTriangle, CheckCircle,
  XCircle, ChevronDown, ChevronRight, Key, Zap, Eye, Shield, ShieldCheck, ShieldX, ShieldAlert as ShieldAlertIcon, Loader2,
} from "lucide-react";

const RISK_CONFIG: Record<string, { color: string; bg: string; border: string; icon: typeof XCircle; label: string }> = {
  "极高": { color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", icon: ShieldX, label: "极高威胁" },
  "高": { color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20", icon: ShieldAlertIcon, label: "高风险" },
  "中": { color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20", icon: AlertTriangle, label: "可疑" },
  "低": { color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20", icon: ShieldCheck, label: "一般" },
};

const RISK_ORDER = ["极高", "高", "中", "低"];

const HISTORY_RISK: Record<string, { color: string; bg: string; icon: typeof ShieldCheck }> = {
  "极高": { color: "text-red-400", bg: "bg-red-500/10", icon: ShieldX },
  "高": { color: "text-orange-400", bg: "bg-orange-500/10", icon: ShieldAlertIcon },
  "中": { color: "text-yellow-400", bg: "bg-yellow-500/10", icon: AlertTriangle },
  "低": { color: "text-green-400", bg: "bg-green-500/10", icon: ShieldCheck },
};

const DIM_LABELS: Record<string, string> = {
  call_frequency: "调用频率", model_usage: "模型使用", success_rate: "成功率",
  request_content: "请求内容", ip_distribution: "IP 分布", token_usage: "Token 消耗",
};

function DimensionCards({ dimensionsJson }: { dimensionsJson: string }) {
  let dims: Record<string, { level: string; description: string }> = {};
  try { const p = JSON.parse(dimensionsJson); if (p && typeof p === "object" && !Array.isArray(p)) dims = p; else return null; } catch { return null; }
  if (Object.keys(dims).length === 0) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-3">
      {Object.entries(dims).map(([key, dim]) => {
        const cfg = RISK_CONFIG[dim.level] || RISK_CONFIG["低"];
        const label = DIM_LABELS[key] || key;
        const RiskIcon = cfg.icon;
        return (
          <div key={key} className={`${cfg.bg} rounded-lg p-2.5`}>
            <div className="flex items-center gap-1.5 mb-1">
              <RiskIcon className={`w-3.5 h-3.5 ${cfg.color}`} />
              <span className="font-medium text-xs">{label}</span>
              <span className={`ml-auto text-xs px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.color} font-medium`}>
                {dim.level}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{dim.description}</p>
          </div>
        );
      })}
    </div>
  );
}

function KeyResultCard({ result }: { result: KeyResult }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = RISK_CONFIG[result.risk_level] || RISK_CONFIG["低"];
  const RiskIcon = cfg.icon;

  let signals: ThreatSignal[] = [];
  try { signals = JSON.parse(result.threat_signals || "[]"); } catch {}

  const scoreColor = result.threat_score >= 35 ? "text-red-400 bg-red-500/10" : result.threat_score >= 20 ? "text-orange-400 bg-orange-500/10" : result.threat_score >= 10 ? "text-yellow-400 bg-yellow-500/10" : "text-green-400 bg-green-500/10";

  return (
    <div className={`rounded-lg border ${cfg.border} ${result.analyzed ? cfg.bg : "bg-secondary/20"} overflow-hidden`}>
      <div
        className="px-3 py-2.5 cursor-pointer hover:bg-secondary/30 flex items-center gap-3"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={14} className="text-muted-foreground shrink-0" /> : <ChevronRight size={14} className="text-muted-foreground shrink-0" />}
        <RiskIcon className={`w-4 h-4 ${cfg.color} shrink-0`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Key size={12} className="text-muted-foreground shrink-0" />
            <span className="text-sm font-medium truncate">{result.api_key_name || result.api_key_id}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.color} font-medium`}>
              {result.analyzed ? result.risk_level : "自动评分"}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${scoreColor} font-medium`}>
              {result.threat_score}分
            </span>
          </div>
          {result.summary && <p className="text-xs text-muted-foreground mt-0.5 truncate">{result.summary}</p>}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground shrink-0">
          {result.new_logs > 0 && <span>+{result.new_logs}新</span>}
          {result.logs_count > 0 && <span>{result.logs_count}条日志</span>}
        </div>
      </div>
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-border/50 space-y-3">
          {signals.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] text-muted-foreground font-medium">威胁指标：</span>
              {signals.map((s, i) => (
                <div key={i} className={`text-[10px] px-2 py-1 rounded ${
                  s.severity === "critical" ? "bg-red-500/10 text-red-400" :
                  s.severity === "high" ? "bg-orange-500/10 text-orange-400" :
                  s.severity === "medium" ? "bg-yellow-500/10 text-yellow-400" :
                  "bg-green-500/10 text-green-400"
                }`}>
                  <span className="font-medium">[{s.rule}]</span> {s.detail}
                </div>
              ))}
            </div>
          )}
          {result.dimensions && <DimensionCards dimensionsJson={result.dimensions} />}
          {result.detail && result.analyzed && (
            <details open>
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">AI 分析报告</summary>
              <pre className="mt-2 p-3 bg-muted/30 rounded text-xs whitespace-pre-wrap max-h-64 overflow-auto font-mono leading-relaxed">{result.detail}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

export default function AlertThreats() {
  const [expandedRisk, setExpandedRisk] = useState<Set<string>>(new Set(RISK_ORDER));
  const [triggering, setTriggering] = useState(false);
  const [expandedHistory, setExpandedHistory] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const { data: config } = useQuery({
    queryKey: ["system-analysis-config"],
    queryFn: () => systemAnalysisApi.getConfig(),
    staleTime: 0,
  });

  const { data: tasksData } = useQuery({
    queryKey: ["system-analysis-tasks"],
    queryFn: () => systemAnalysisApi.listTasks(),
    staleTime: 0,
  });

  const { data: statusData } = useQuery({
    queryKey: ["system-analysis-status"],
    queryFn: () => systemAnalysisApi.getStatus(),
    staleTime: 0,
    refetchInterval: 3000,
  });

  const { data: keyResultsData, refetch: refetchResults } = useQuery({
    queryKey: ["system-analysis-key-results"],
    queryFn: () => systemAnalysisApi.getKeyResults(),
    staleTime: 0,
    refetchInterval: 30000,
  });

  const { data: historyData, refetch: refetchHistory } = useQuery({
    queryKey: ["system-analysis-history"],
    queryFn: () => systemAnalysisApi.getHistory(),
    staleTime: 0,
  });

  const { data: alertStats } = useQuery({
    queryKey: ["threat-alerts"],
    queryFn: () => apiRequest<{ by_severity: Record<string, number> }>("GET", `/stats/alert-severity?period=1440`),
    staleTime: 0, refetchInterval: 15000,
  });

  const { data: historyDetailData } = useQuery({
    queryKey: ["system-analysis-history-detail", expandedHistory],
    queryFn: () => systemAnalysisApi.getKeyResults(undefined, expandedHistory!),
    enabled: expandedHistory !== null,
    staleTime: 0,
  });

  const tasks: SystemAnalysisTask[] = tasksData?.tasks || [];
  const systemTask = tasks.find((t) => t.id);
  const keyResults: Record<string, KeyResult[]> = keyResultsData?.results || {};
  const history: SystemAnalysisHistory[] = historyData?.history || [];
  const highRiskCount = (alertStats?.by_severity?.critical || 0) + (alertStats?.by_severity?.high || 0);
  const isRunning = statusData?.running || false;

  const allResults = Object.values(keyResults).flat();
  const latestRunAt = allResults.length > 0 ? allResults.reduce((latest, r) => r.run_at > latest ? r.run_at : latest, allResults[0].run_at) : null;
  const latestResults = latestRunAt ? allResults.filter(r => r.run_at === latestRunAt) : [];
  const latestAnalyzed = latestResults.filter(r => r.analyzed);
  const latestAutoScored = latestResults.filter(r => !r.analyzed);
  const latestByRisk: Record<string, KeyResult[]> = {};
  for (const r of latestResults) {
    const rl = r.risk_level || "低";
    if (!latestByRisk[rl]) latestByRisk[rl] = [];
    latestByRisk[rl].push(r);
  }
  const latestTotal = latestResults.length;

  const formatTime = (ts: string | null | undefined) => {
    if (!ts) return "-";
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const handleTrigger = useCallback(async () => {
    if (triggering || isRunning) return;
    setTriggering(true);
    try {
      await systemAnalysisApi.trigger();
      setTimeout(() => {
        refetchResults();
        refetchHistory();
        queryClient.invalidateQueries({ queryKey: ["system-analysis-status"] });
      }, 2000);
    } finally {
      setTimeout(() => setTriggering(false), 3000);
    }
  }, [triggering, isRunning, refetchResults, refetchHistory, queryClient]);

  const toggleRisk = (risk: string) => {
    setExpandedRisk((prev) => {
      const next = new Set(prev);
      if (next.has(risk)) next.delete(risk); else next.add(risk);
      return next;
    });
  };

  const historyDetailResults = historyDetailData?.results || {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center border border-red-500/20">
            <Shield size={20} className="text-red-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">威胁挖掘</h1>
            <p className="text-sm text-muted-foreground mt-1">基于 AI 行为分析的系统级威胁识别与挖掘</p>
          </div>
        </div>
        <button
          onClick={handleTrigger}
          disabled={triggering || isRunning}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm transition-colors ${
            triggering || isRunning
              ? "bg-secondary text-muted-foreground cursor-not-allowed"
              : "bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20"
          }`}
        >
          {triggering || isRunning ? (
            <><Loader2 size={14} className="animate-spin" /> 分析执行中...</>
          ) : (
            <><Play size={14} /> 立即执行分析</>
          )}
        </button>
      </div>

      {(triggering || isRunning) && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg px-4 py-2.5 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin text-blue-400" />
          <span className="text-sm text-blue-400">正在执行系统行为分析，请等待完成后再操作...</span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card rounded-xl p-4 border border-border">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="text-blue-400" size={16} />
            <span className="text-xs text-muted-foreground">分析引擎</span>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${config?.enabled ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground"}`} />
            <span className="text-lg font-bold">{config?.enabled ? "运行中" : "已停止"}</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">模型: {config?.model || "未配置"} | 间隔: {config?.interval_minutes || 60}min</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border">
          <div className="flex items-center gap-2 mb-2">
            <ShieldAlert className="text-red-400" size={16} />
            <span className="text-xs text-muted-foreground">高危威胁 (24h)</span>
          </div>
          <p className="text-3xl font-bold text-red-400">{highRiskCount}</p>
          <p className="text-[10px] text-muted-foreground mt-1">严重 + 高危告警</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="text-amber-400" size={16} />
            <span className="text-xs text-muted-foreground">最近执行</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold">{latestResults.length}</span>
            <span className="text-xs text-muted-foreground">个会话</span>
          </div>
          <div className="flex gap-3 mt-1">
            <span className="text-[10px] text-blue-400">AI分析 {latestAnalyzed.length}</span>
            <span className="text-[10px] text-green-400">评分 {latestAutoScored.length}</span>
          </div>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="text-purple-400" size={16} />
            <span className="text-xs text-muted-foreground">综合风险</span>
          </div>
          {systemTask?.result_risk_level ? (
            (() => {
              const cfg = RISK_CONFIG[systemTask.result_risk_level] || RISK_CONFIG["低"];
              return <span className={`text-2xl font-bold ${cfg.color}`}>{systemTask.result_risk_level}</span>;
            })()
          ) : (
            <span className="text-2xl font-bold text-muted-foreground">-</span>
          )}
          <p className="text-[10px] text-muted-foreground mt-1">
            {systemTask?.result_risk_level ? "系统整体安全评估" : "尚未分析"}
          </p>
        </div>
      </div>

      {/* 最近执行详情 */}
      <div className="bg-card rounded-xl border border-border">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Eye size={16} className="text-red-400" />
          <span className="text-sm font-semibold">最近执行详情</span>
          {latestRunAt && <span className="text-xs text-muted-foreground ml-2">{formatTime(latestRunAt)} · {latestTotal} 个会话</span>}
          <button onClick={() => refetchResults()} className="ml-auto p-1 text-muted-foreground hover:text-foreground">
            <RefreshCw size={14} />
          </button>
        </div>

        {latestTotal === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            暂无分析结果{config?.enabled ? "，等待下次自动分析或点击右上角手动执行" : "，请先在防护策略中启用并配置高级策略"}
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {systemTask?.result_summary && (
              <div className="bg-muted/30 rounded-lg p-3 text-sm text-muted-foreground">{systemTask.result_summary}</div>
            )}
            {RISK_ORDER.map((risk) => {
              const items = latestByRisk[risk];
              if (!items || items.length === 0) return null;
              const cfg = RISK_CONFIG[risk];
              const RiskIcon = cfg.icon;
              const isExpanded = expandedRisk.has(risk);

              return (
                <div key={risk} className={`rounded-xl border ${cfg.border} overflow-hidden`}>
                  <div
                    className={`px-4 py-3 ${cfg.bg} cursor-pointer flex items-center gap-3`}
                    onClick={() => toggleRisk(risk)}
                  >
                    {isExpanded ? <ChevronDown size={16} className={cfg.color} /> : <ChevronRight size={16} className={cfg.color} />}
                    <RiskIcon className={`w-5 h-5 ${cfg.color}`} />
                    <span className={`text-sm font-semibold ${cfg.color}`}>{cfg.label}</span>
                    <span className={`ml-1 text-xs px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color} font-bold`}>
                      {items.length} 条
                    </span>
                    <div className="flex-1" />
                    <span className="text-xs text-muted-foreground">
                      {items.reduce((sum, r) => sum + (r.logs_count || 0), 0)} 条日志
                    </span>
                  </div>
                  {isExpanded && (
                    <div className="p-3 space-y-2">
                      {items.map((result) => (
                        <KeyResultCard key={result.id} result={result} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 历史记录 */}
      {history.length > 0 && (
        <div className="bg-card rounded-xl border border-border">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Clock size={16} className="text-amber-400" />
            <span className="text-sm font-semibold">历史记录</span>
            <span className="text-xs text-muted-foreground ml-2">{history.length} 次</span>
            <button onClick={() => refetchHistory()} className="ml-auto p-1 text-muted-foreground hover:text-foreground">
              <RefreshCw size={14} />
            </button>
          </div>
          <div className="divide-y divide-border max-h-96 overflow-y-auto">
            {history.map((record) => {
              const cfg = HISTORY_RISK[record.risk_level] || HISTORY_RISK["低"];
              const Icon = cfg.icon;
              const isOpen = expandedHistory === record.id;

              return (
                <div key={record.id}>
                  <div
                    className="px-4 py-2.5 cursor-pointer hover:bg-secondary/30 flex items-center gap-3"
                    onClick={() => setExpandedHistory(isOpen ? null : record.id)}
                  >
                    {isOpen ? <ChevronDown size={12} className="text-muted-foreground shrink-0" /> : <ChevronRight size={12} className="text-muted-foreground shrink-0" />}
                    <Icon className={`w-3.5 h-3.5 ${cfg.color} shrink-0`} />
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.color} font-medium`}>
                      {record.risk_level || "unknown"}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatTime(record.run_at)}</span>
                    {record.duration_ms > 0 && <span className="text-[10px] text-muted-foreground">{(record.duration_ms / 1000).toFixed(1)}s</span>}
                    {(record.logs_analyzed ?? 0) > 0 && <span className="text-[10px] text-muted-foreground">{record.logs_analyzed}条日志</span>}
                    {record.summary && <span className="text-xs text-muted-foreground flex-1 truncate ml-2">{record.summary}</span>}
                  </div>
                  {isOpen && (
                    <div className="px-4 pb-3 space-y-3 border-t border-border/50 pt-2">
                      {record.summary && <p className="text-xs bg-muted/30 rounded p-2">{record.summary}</p>}
                      {(() => {
                        const allDetail = Object.values(historyDetailResults).flat();
                        if (allDetail.length === 0) return <p className="text-xs text-muted-foreground">暂无详细结果</p>;
                        return RISK_ORDER.map((risk) => {
                          const items = historyDetailResults[risk];
                          if (!items || items.length === 0) return null;
                          const rc = RISK_CONFIG[risk];
                          return (
                            <div key={risk} className="space-y-2">
                              <div className="flex items-center gap-1.5">
                                <rc.icon className={`w-3.5 h-3.5 ${rc.color}`} />
                                <span className={`text-xs font-semibold ${rc.color}`}>{rc.label}</span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${rc.bg} ${rc.color}`}>{items.length}</span>
                              </div>
                              {items.map((result) => (
                                <KeyResultCard key={result.id} result={result} />
                              ))}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
