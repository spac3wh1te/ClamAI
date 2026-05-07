import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { systemAnalysisApi, type SystemAnalysisHistory, type SystemAnalysisTask } from "../../api/analysis";
import { apiRequest } from "../../api/client";
import { Activity, ShieldAlert, Play, RefreshCw, Clock, AlertTriangle, CheckCircle, XCircle } from "lucide-react";

const RISK_CONFIG: Record<string, { color: string; bg: string; icon: typeof XCircle }> = {
  "极高": { color: "text-red-400", bg: "bg-red-500/10", icon: XCircle },
  "高": { color: "text-orange-400", bg: "bg-orange-500/10", icon: XCircle },
  "中": { color: "text-yellow-400", bg: "bg-yellow-500/10", icon: AlertTriangle },
  "低": { color: "text-green-400", bg: "bg-green-500/10", icon: CheckCircle },
};

function DimensionCards({ dimensionsJson }: { dimensionsJson: string }) {
  let dims: Record<string, { level: string; description: string }> = {};
  try { dims = JSON.parse(dimensionsJson); } catch { return null; }
  if (!dims || Object.keys(dims).length === 0) return null;

  const dimLabels: Record<string, string> = {
    call_frequency: "调用频率",
    model_usage: "模型使用",
    success_rate: "成功率",
    request_content: "请求内容",
    ip_distribution: "IP 分布",
    token_usage: "Token 消耗",
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-3">
      {Object.entries(dims).map(([key, dim]) => {
        const cfg = RISK_CONFIG[dim.level] || RISK_CONFIG["低"];
        const label = dimLabels[key] || key;
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

export default function AlertThreats() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

  const { data: historyData, refetch: refetchHistory } = useQuery({
    queryKey: ["system-analysis-history"],
    queryFn: () => systemAnalysisApi.getHistory(),
    staleTime: 0,
    refetchInterval: 30000,
  });

  const { data: alertStats } = useQuery({
    queryKey: ["threat-alerts"],
    queryFn: () => apiRequest<{ by_severity: Record<string, number> }>("GET", `/stats/alert-severity?period=1440`),
    staleTime: 0, refetchInterval: 15000,
  });

  const tasks: SystemAnalysisTask[] = tasksData?.tasks || [];
  const history: SystemAnalysisHistory[] = historyData?.history || [];
  const systemTask = tasks.find((t) => t.id);

  const highRiskCount = (alertStats?.by_severity?.critical || 0) + (alertStats?.by_severity?.high || 0);

  const formatTime = (ts: string) => {
    if (!ts) return "-";
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const triggerMutation = () => {
    systemAnalysisApi.trigger().then(() => {
      setTimeout(() => {
        refetchHistory();
      }, 2000);
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center border border-red-500/20">
          <Activity size={20} className="text-red-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">威胁挖掘</h1>
          <p className="text-sm text-muted-foreground mt-1">基于 AI 行为分析的系统级威胁识别</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-card rounded-xl p-5 border border-border">
          <div className="flex items-center gap-3 mb-3">
            <Activity className="text-red-400" size={20} />
            <h3 className="text-sm font-semibold">分析状态</h3>
          </div>
          <p className="text-2xl font-bold">{config?.enabled ? "运行中" : "已停止"}</p>
          <p className="text-xs text-muted-foreground mt-1">每 {config?.interval_minutes || 60} 分钟</p>
        </div>
        <div className="bg-card rounded-xl p-5 border border-border">
          <div className="flex items-center gap-3 mb-3">
            <ShieldAlert className="text-orange-400" size={20} />
            <h3 className="text-sm font-semibold">高危威胁</h3>
          </div>
          <p className="text-3xl font-bold">{highRiskCount}</p>
          <p className="text-xs text-muted-foreground mt-1">严重 + 高危 (近24h)</p>
        </div>
        <div className="bg-card rounded-xl p-5 border border-border">
          <div className="flex items-center gap-3 mb-3">
            <Clock className="text-amber-400" size={20} />
            <h3 className="text-sm font-semibold">最近分析</h3>
          </div>
          <p className="text-sm font-bold truncate">{systemTask?.result_summary || "暂无"}</p>
          <p className="text-xs text-muted-foreground mt-1">{systemTask?.last_run_at ? formatTime(systemTask.last_run_at) : "从未运行"}</p>
        </div>
        <div className="bg-card rounded-xl p-5 border border-border">
          <div className="flex items-center gap-3 mb-3">
            <AlertTriangle className="text-purple-400" size={20} />
            <h3 className="text-sm font-semibold">风险等级</h3>
          </div>
          {systemTask?.result_risk_level ? (
            (() => {
              const cfg = RISK_CONFIG[systemTask.result_risk_level] || RISK_CONFIG["低"];
              return <span className={`text-2xl font-bold ${cfg.color}`}>{systemTask.result_risk_level}</span>;
            })()
          ) : (
            <span className="text-2xl font-bold text-muted-foreground">-</span>
          )}
          <p className="text-xs text-muted-foreground mt-1">{history.length} 次历史分析</p>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Activity size={16} className="text-red-400" />
          <span className="text-sm font-semibold">系统行为分析任务</span>
          <span className="text-xs text-muted-foreground ml-auto">{tasks.length} 个任务</span>
          <button
            onClick={triggerMutation}
            className="flex items-center gap-1 px-2.5 py-1 text-xs bg-primary/10 text-primary border border-primary/30 rounded-md hover:bg-primary/20 ml-2"
          >
            <Play size={12} /> 立即执行
          </button>
        </div>

        {tasks.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            暂无系统分析任务，请通过&quot;防护策略 &gt; 高级策略&quot;配置
          </div>
        ) : (
          <div className="divide-y divide-border">
            {tasks.map((task) => (
              <div key={task.id}>
                <div
                  className="px-4 py-3 cursor-pointer hover:bg-secondary/30"
                  onClick={() => setExpandedId(expandedId === String(task.id) ? null : String(task.id))}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">#{task.task_no}</span>
                    <span className="text-sm font-medium">{task.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      task.status === "running" ? "bg-blue-500/10 text-blue-400" : "bg-secondary text-muted-foreground"
                    }`}>
                      {task.status === "running" ? "运行中" : task.status}
                    </span>
                    {task.result_risk_level && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        RISK_CONFIG[task.result_risk_level]?.bg || "bg-secondary"
                      } ${RISK_CONFIG[task.result_risk_level]?.color || "text-muted-foreground"}`}>
                        {task.result_risk_level}风险
                      </span>
                    )}
                  </div>
                  {task.result_summary && (
                    <p className="text-xs text-muted-foreground mt-1 truncate">{task.result_summary}</p>
                  )}
                </div>

                {expandedId === String(task.id) && task.result_detail && (
                  <div className="px-4 pb-4 space-y-3">
                    {task.result_dimensions && <DimensionCards dimensionsJson={task.result_dimensions} />}
                    {task.result_detail && (
                      <details open>
                        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">详细分析报告</summary>
                        <pre className="mt-2 p-3 bg-muted/30 rounded text-xs whitespace-pre-wrap max-h-48 overflow-auto">{task.result_detail}</pre>
                      </details>
                    )}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      {task.last_run_at && <span><Clock size={12} className="inline mr-1" />{formatTime(task.last_run_at)}</span>}
                      {(task.result_logs_analyzed ?? 0) > 0 && <span>{task.result_logs_analyzed} 条日志</span>}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-card rounded-xl border border-border">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Activity size={16} className="text-amber-400" />
          <span className="text-sm font-semibold">历史分析记录</span>
          <button onClick={() => refetchHistory()} className="ml-auto p-1 text-muted-foreground hover:text-foreground">
            <RefreshCw size={14} />
          </button>
        </div>
        {history.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">暂无历史记录</div>
        ) : (
          <div className="divide-y divide-border max-h-96 overflow-y-auto">
            {history.map((record) => {
              const cfg = RISK_CONFIG[record.risk_level] || RISK_CONFIG["低"];
              const RiskIcon = cfg.icon;
              return (
                <div key={record.id} className="px-4 py-3">
                  <div className="flex items-start gap-2">
                    <RiskIcon className={`w-4 h-4 ${cfg.color} mt-0.5 shrink-0`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.color} font-medium`}>{record.risk_level}</span>
                        <span className="text-xs text-muted-foreground"><Clock size={12} className="inline mr-1" />{formatTime(record.run_at)}</span>
                        {record.duration_ms > 0 && <span className="text-xs text-muted-foreground">{(record.duration_ms / 1000).toFixed(1)}s</span>}
                        {(record.logs_analyzed ?? 0) > 0 && <span className="text-xs text-muted-foreground">{record.logs_analyzed}条日志</span>}
                      </div>
                      {record.summary && <p className="text-xs text-muted-foreground mt-1">{record.summary}</p>}
                      {record.dimensions && <DimensionCards dimensionsJson={record.dimensions} />}
                      {record.detail && (
                        <details className="mt-2">
                          <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">报告详情</summary>
                          <pre className="mt-1 p-2 bg-muted/30 rounded text-[10px] whitespace-pre-wrap max-h-32 overflow-auto">{record.detail}</pre>
                        </details>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}