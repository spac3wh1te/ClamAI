import { useState, useEffect, useCallback } from "react";
import { Shield, BookOpen, Brain, Database, Zap, Save, RefreshCw, Play, Clock, AlertTriangle, CheckCircle, Loader2, ChevronDown, ChevronRight, Key, ShieldCheck, ShieldX, ShieldAlert } from "lucide-react";
import Security from "./Security";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { systemAnalysisApi, type SystemAnalysisConfig, type SystemAnalysisTask, type SystemAnalysisHistory } from "../api/analysis";
import { proxyApi } from "../api/stats";

const TABS = [
  { id: "config", label: "安全配置", icon: Shield },
  { id: "keyword", label: "关键词词库", icon: BookOpen },
  { id: "semantic", label: "语义检测", icon: Brain },
  { id: "vector", label: "向量样本库", icon: Database },
  { id: "advanced", label: "高级策略", icon: Zap },
] as const;

const TIME_RANGE_OPTIONS = [
  { value: "1d", label: "最近 1 天" },
  { value: "3d", label: "最近 3 天" },
  { value: "7d", label: "最近 7 天" },
  { value: "30d", label: "最近 30 天" },
];

const INTERVAL_OPTIONS = [
  { value: 15, label: "每 15 分钟" },
  { value: 30, label: "每 30 分钟" },
  { value: 60, label: "每 1 小时" },
  { value: 120, label: "每 2 小时" },
  { value: 360, label: "每 6 小时" },
];

const HISTORY_RISK: Record<string, { color: string; bg: string; icon: typeof ShieldCheck }> = {
  "极高": { color: "text-red-400", bg: "bg-red-500/10", icon: ShieldX },
  "高": { color: "text-orange-400", bg: "bg-orange-500/10", icon: ShieldAlert },
  "中": { color: "text-yellow-400", bg: "bg-yellow-500/10", icon: AlertTriangle },
  "低": { color: "text-green-400", bg: "bg-green-500/10", icon: ShieldCheck },
};

function HistoryDimensionCards({ json }: { json: string }) {
  let dims: Record<string, { level: string; description: string }> = {};
  try { const p = JSON.parse(json); if (p && typeof p === "object" && !Array.isArray(p)) dims = p; else return null; } catch { return null; }
  if (Object.keys(dims).length === 0) return null;
  const labels: Record<string, string> = {
    call_frequency: "调用频率", model_usage: "模型使用", success_rate: "成功率",
    request_content: "请求内容", ip_distribution: "IP 分布", token_usage: "Token 消耗",
  };
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
      {Object.entries(dims).map(([k, d]) => {
        const c = HISTORY_RISK[d.level] || HISTORY_RISK["低"];
        const Icon = c.icon;
        return (
          <div key={k} className={`${c.bg} rounded p-2`}>
            <div className="flex items-center gap-1 mb-0.5">
              <Icon className={`w-3 h-3 ${c.color}`} />
              <span className="text-[10px] font-medium">{labels[k] || k}</span>
              <span className={`ml-auto text-[10px] ${c.color}`}>{d.level}</span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">{d.description}</p>
          </div>
        );
      })}
    </div>
  );
}

function HistoryRecord({ record, cfg, formatTime, keyResults }: {
  record: SystemAnalysisHistory;
  cfg: { color?: string; bg?: string };
  formatTime: (ts: string) => string;
  keyResults: Array<{ api_key_name: string; risk_level: string; summary: string; dimensions: string }>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="px-4 py-2.5 cursor-pointer hover:bg-secondary/30 flex items-center gap-3" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={12} className="text-muted-foreground shrink-0" /> : <ChevronRight size={12} className="text-muted-foreground shrink-0" />}
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${cfg.bg || "bg-secondary"} ${cfg.color || "text-muted-foreground"} font-medium`}>
          {record.risk_level || "unknown"}
        </span>
        <span className="text-xs text-muted-foreground">{formatTime(record.run_at)}</span>
        {record.duration_ms > 0 && <span className="text-[10px] text-muted-foreground">{(record.duration_ms / 1000).toFixed(1)}s</span>}
        {(record.logs_analyzed ?? 0) > 0 && <span className="text-[10px] text-muted-foreground">{record.logs_analyzed}条日志</span>}
        {keyResults.length > 0 && <span className="text-[10px] text-muted-foreground">{keyResults.length}个Key</span>}
        {record.summary && <span className="text-xs text-muted-foreground flex-1 truncate ml-2">{record.summary}</span>}
      </div>
      {open && (
        <div className="px-4 pb-3 space-y-3 border-t border-border/50 pt-2">
          {record.summary && <p className="text-xs bg-muted/30 rounded p-2">{record.summary}</p>}
          {keyResults.length > 0 && (
            <div className="space-y-2">
              <span className="text-[10px] text-muted-foreground font-medium">各会话分析结果：</span>
              {keyResults.map((kr, i) => {
                const rc = HISTORY_RISK[kr.risk_level] || HISTORY_RISK["低"];
                const Icon = rc.icon;
                return (
                  <div key={i} className={`${rc.bg} border ${rc.bg.replace("/10", "/20")} rounded-lg p-2.5`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className={`w-3.5 h-3.5 ${rc.color}`} />
                      <Key size={11} className="text-muted-foreground" />
                      <span className="text-xs font-medium">{kr.api_key_name || "未知"}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${rc.bg} ${rc.color}`}>{kr.risk_level}</span>
                    </div>
                    {kr.summary && <p className="text-[10px] text-muted-foreground ml-5">{kr.summary}</p>}
                    {kr.dimensions && <div className="ml-5"><HistoryDimensionCards json={kr.dimensions} /></div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AdvancedPolicy() {
  const queryClient = useQueryClient();

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ["system-analysis-config"],
    queryFn: () => systemAnalysisApi.getConfig(),
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
  });

  const { data: modelsData } = useQuery({ queryKey: ["models"], queryFn: () => proxyApi.getModels().catch(() => []) });
  const models = Array.isArray(modelsData) ? modelsData : [];
  const tasks: SystemAnalysisTask[] = Array.isArray(tasksData?.tasks) ? tasksData.tasks : [];
  const history: SystemAnalysisHistory[] = Array.isArray(historyData?.history) ? historyData.history : [];
  const systemTask = tasks.find((t) => (t as any).created_by === "__system__");

  const [form, setForm] = useState<SystemAnalysisConfig>({
    enabled: true,
    model: "",
    api_key_id: "",
    time_range: "7d",
    interval_minutes: 60,
    notify_on_high_risk: true,
    auto_block_risk_level: "",
    system_prompt: "",
  });

  useEffect(() => {
    if (config) {
      setForm({
        enabled: config.enabled,
        model: config.model,
        api_key_id: "",
        time_range: config.time_range,
        interval_minutes: config.interval_minutes,
        notify_on_high_risk: config.notify_on_high_risk,
        auto_block_risk_level: config.auto_block_risk_level,
        system_prompt: config.system_prompt || "",
      });
    }
  }, [config]);

  const [msg, setMsg] = useState<{ text: string; type: "ok" | "err" } | null>(null);
  const showMsg = (text: string, type: "ok" | "err") => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 3000);
  };

  const updateMutation = useMutation({
    mutationFn: (cfg: SystemAnalysisConfig) => systemAnalysisApi.updateConfig(cfg),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-analysis-config"] });
      queryClient.invalidateQueries({ queryKey: ["system-analysis-tasks"] });
      showMsg("配置已保存", "ok");
    },
    onError: (e: any) => showMsg(e?.message || "保存失败", "err"),
  });

  const [triggering, setTriggering] = useState(false);

  const { data: statusData } = useQuery({
    queryKey: ["system-analysis-status"],
    queryFn: () => systemAnalysisApi.getStatus(),
    staleTime: 0,
    refetchInterval: 3000,
  });

  const isRunning = statusData?.running || false;

  const handleTrigger = useCallback(async () => {
    if (triggering || isRunning) return;
    setTriggering(true);
    try {
      const resp = await systemAnalysisApi.trigger();
      if ((resp as any).success === false) {
        showMsg((resp as any).message || "触发失败", "err");
      } else {
        showMsg("已触发执行", "ok");
        setTimeout(() => refetchHistory(), 3000);
      }
    } catch (e: any) {
      showMsg(e?.message || "触发失败", "err");
    } finally {
      setTimeout(() => setTriggering(false), 3000);
    }
  }, [triggering, isRunning, refetchHistory]);

  const formatTime = (ts: string) => {
    if (!ts) return "-";
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const RISK_CONFIG: Record<string, { color: string; bg: string }> = {
    "极高": { color: "text-red-400", bg: "bg-red-500/10" },
    "高": { color: "text-orange-400", bg: "bg-orange-500/10" },
    "中": { color: "text-yellow-400", bg: "bg-yellow-500/10" },
    "低": { color: "text-green-400", bg: "bg-green-500/10" },
  };

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-xl border border-border">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Zap size={16} className="text-amber-400" />
          <span className="text-sm font-semibold">系统行为分析配置</span>
          <span className="text-xs text-muted-foreground ml-2">自动分析所有 API Key 调用行为，识别未知威胁</span>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex items-center gap-3 p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
            <div className="flex items-center gap-2">
              {form.enabled ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-sm text-emerald-400 font-medium">已启用</span>
                </>
              ) : (
                <>
                  <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                  <span className="text-sm text-muted-foreground">已禁用</span>
                </>
              )}
            </div>
            <span className="text-xs text-muted-foreground ml-2">
              开启后系统将按照配置的间隔自动执行行为分析任务
            </span>
            <button
              onClick={() => {
                const newEnabled = !form.enabled;
                setForm({ ...form, enabled: newEnabled });
                updateMutation.mutate({ ...form, enabled: newEnabled });
              }}
              className={`ml-auto px-3 py-1.5 text-xs rounded-md border transition-colors ${
                form.enabled ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-secondary text-muted-foreground border-border"
              }`}
            >
              {form.enabled ? "点击停止" : "点击启用"}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground font-medium block mb-1.5">分析模型</label>
              <select
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
              >
                <option value="">选择模型...</option>
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium block mb-1.5">分析范围</label>
              <div className="px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-muted-foreground">
                自动分析所有 API Key
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium block mb-1.5">分析时间范围</label>
              <select
                value={form.time_range}
                onChange={(e) => setForm({ ...form, time_range: e.target.value })}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
              >
                {TIME_RANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium block mb-1.5">执行间隔</label>
              <select
                value={form.interval_minutes}
                onChange={(e) => setForm({ ...form, interval_minutes: parseInt(e.target.value) })}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
              >
                {INTERVAL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-4 pt-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.notify_on_high_risk}
                onChange={(e) => setForm({ ...form, notify_on_high_risk: e.target.checked })}
                className="w-4 h-4 rounded border-border"
              />
              <span className="text-muted-foreground">高风险时记录安全告警</span>
            </label>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => updateMutation.mutate(form)}
              disabled={updateMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary/90 disabled:opacity-50"
            >
              <Save size={14} />
              {updateMutation.isPending ? "保存中..." : "保存配置"}
            </button>
            <button
              onClick={handleTrigger}
              disabled={triggering || isRunning}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm transition-colors ${
                triggering || isRunning
                  ? "bg-secondary text-muted-foreground cursor-not-allowed"
                  : "bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20"
              }`}
            >
              {triggering || isRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {triggering || isRunning ? "执行中..." : "立即执行一次"}
            </button>
            {msg && (
              <span className={`text-xs px-2 py-1 rounded ${msg.type === "ok" ? "text-emerald-400 bg-emerald-500/10" : "text-red-400 bg-red-500/10"}`}>
                {msg.text}
              </span>
            )}
          </div>

          <details className="mt-3">
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none">
              分析提示词配置
            </summary>
            <div className="mt-3 space-y-3">
              <textarea
                value={form.system_prompt}
                onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
                className="w-full p-3 bg-muted/30 border border-border rounded-lg text-xs font-mono leading-relaxed resize-y min-h-[200px] focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="自定义分析提示词..."
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={() => updateMutation.mutate(form)}
                  disabled={updateMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs hover:bg-primary/90 disabled:opacity-50"
                >
                  <Save size={12} />
                  保存提示词
                </button>
                <button
                  onClick={async () => {
                    try {
                      const resp = await systemAnalysisApi.getDefaultPrompt();
                      const newForm = { ...form, system_prompt: resp.prompt };
                      setForm(newForm);
                      updateMutation.mutate(newForm);
                    } catch {}
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-secondary-foreground rounded-md text-xs hover:bg-secondary/80"
                >
                  <RefreshCw size={12} />
                  重置为默认
                </button>
              </div>
            </div>
          </details>
        </div>
      </div>

      {systemTask && (
        <div className="bg-card rounded-xl border border-border">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Clock size={14} className="text-muted-foreground" />
            <span className="text-sm font-semibold">当前任务状态</span>
          </div>
          <div className="p-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${systemTask.status === "running" ? "bg-blue-400 animate-pulse" : "bg-muted-foreground"}`} />
                <span className="text-sm">{systemTask.status === "running" ? "运行中" : systemTask.status}</span>
              </div>
              {systemTask.result_risk_level && (
                <span className={`text-xs px-2 py-0.5 rounded ${RISK_CONFIG[systemTask.result_risk_level]?.bg || "bg-secondary"} ${RISK_CONFIG[systemTask.result_risk_level]?.color || "text-muted-foreground"}`}>
                  {systemTask.result_risk_level}风险
                </span>
              )}
              {systemTask.last_run_at && <span className="text-xs text-muted-foreground">上次: {formatTime(systemTask.last_run_at)}</span>}
              {systemTask.next_run_at && systemTask.schedule_type === "periodic" && (
                <span className="text-xs text-muted-foreground">下次: {formatTime(systemTask.next_run_at)}</span>
              )}
            </div>
            {systemTask.result_summary && (
              <p className="text-sm text-muted-foreground mt-2">{systemTask.result_summary}</p>
            )}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="bg-card rounded-xl border border-border">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Clock size={14} className="text-muted-foreground" />
            <span className="text-sm font-semibold">历史分析记录</span>
            <span className="text-xs text-muted-foreground ml-2">{history.length} 次</span>
            <button onClick={() => refetchHistory()} className="ml-auto p-1 text-muted-foreground hover:text-foreground">
              <RefreshCw size={14} />
            </button>
          </div>
          <div className="divide-y divide-border max-h-96 overflow-y-auto">
            {history.map((record) => {
              const cfg = RISK_CONFIG[record.risk_level] || {};
              let keyResults: Array<{ api_key_name: string; risk_level: string; summary: string; dimensions: string }> = [];
              if (record.detail) {
                try { const p = JSON.parse(record.detail); if (Array.isArray(p)) keyResults = p; } catch {}
              }
              return (
                <HistoryRecord
                  key={record.id}
                  record={record}
                  cfg={cfg}
                  formatTime={formatTime}
                  keyResults={keyResults}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SecurityPolicy() {
  const [tab, setTab] = useState<string>("config");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">防护策略</h1>
        <p className="text-sm text-muted-foreground mt-1">内容安全策略与检测规则配置</p>
      </div>
      <div className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t.id ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            }`}
          >
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>
      <div>
        {tab !== "advanced" ? (
          <Security key={tab} initialTab={tab as "config" | "keyword" | "semantic" | "vector"} />
        ) : (
          <AdvancedPolicy />
        )}
      </div>
    </div>
  );
}