import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { analysisApi } from "../../api/analysis";
import { keysApi } from "../../api/keys";
import { proxyApi } from "../../api/stats";
import {
  Shield,
  FileText,
  Loader2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  User,
  Plus,
  Trash2,
  Play,
  Pause,
  History,
  RefreshCw,
  Clock,
  Repeat,
  Activity,
  TrendingUp,
  Globe,
  Cpu,
  Zap,
  Pencil,
  CheckSquare,
  Square,
  X,
} from "lucide-react";
import { registerSecurityApp } from "./registry";

interface ApiKey {
  id: string;
  name: string;
  key: string;
  active: boolean;
  allowed_models: string[];
}

interface AnalysisTask {
  id: string;
  task_no: string;
  name: string;
  api_key_id: string;
  model: string;
  time_range: string;
  schedule_type: string;
  interval_minutes: number;
  status: string;
  progress?: string;
  last_run_at?: string;
  next_run_at?: string;
  created_at?: string;
  result_summary?: string;
  result_risk_level?: string;
  result_detail?: string;
  result_dimensions?: string;
  result_logs_analyzed?: number;
}



const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  idle: { bg: "bg-muted", text: "text-muted-foreground", label: "空闲" },
  running: { bg: "bg-blue-500/10", text: "text-blue-500", label: "运行中" },
  error: { bg: "bg-red-500/10", text: "text-red-500", label: "错误" },
};



const RISK_CARD: Record<string, { bg: string; border: string; text: string; icon: typeof XCircle }> = {
  极高: { bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-500", icon: XCircle },
  高: { bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-500", icon: XCircle },
  中: { bg: "bg-orange-500/10", border: "border-orange-500/30", text: "text-orange-500", icon: AlertTriangle },
  低: { bg: "bg-green-500/10", border: "border-green-500/30", text: "text-green-500", icon: CheckCircle },
};

const DIMENSION_ICONS: Record<string, typeof Activity> = {
  call_frequency: Clock,
  model_usage: Cpu,
  success_rate: TrendingUp,
  request_content: FileText,
  ip_distribution: Globe,
  token_usage: Zap,
};

const DIMENSION_LABELS: Record<string, string> = {
  call_frequency: "调用频率",
  model_usage: "模型使用",
  success_rate: "成功率",
  request_content: "请求内容",
  ip_distribution: "IP 分布",
  token_usage: "Token 消耗",
};

function DimensionCards({ dimensionsJson }: { dimensionsJson: string }) {
  let dims: Record<string, { level: string; description: string }> = {};
  try {
    dims = JSON.parse(dimensionsJson);
  } catch {
    return null;
  }
  if (!dims || Object.keys(dims).length === 0) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 mt-3">
      {Object.entries(dims).map(([key, dim]) => {
        const cfg = RISK_CARD[dim.level] || RISK_CARD["低"];
        const Icon = DIMENSION_ICONS[key] || Activity;
        const label = DIMENSION_LABELS[key] || key;
        const RiskIcon = cfg.icon;
        return (
          <div key={key} className={`${cfg.bg} border ${cfg.border} rounded-lg p-2.5`}>
            <div className="flex items-center gap-1.5 mb-1">
              <Icon className={`w-3.5 h-3.5 ${cfg.text}`} />
              <span className="font-medium text-xs">{label}</span>
              <span className={`ml-auto text-xs px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.text} font-medium`}>
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

function AnalysisEditForm({ task, apiKeys, models, onSave, onCancel }: {
  task: any; apiKeys: any[]; models: string[]; onSave: (name: string, apiKeyId: string, model: string, timeRange: string) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(task.name);
  const [apiKeyId, setApiKeyId] = useState(task.api_key_id);
  const [model, setModel] = useState(task.model);
  const [timeRange, setTimeRange] = useState(task.time_range || "7d");
  return (
    <div className="px-4 py-3 border-t border-border space-y-3">
      <h4 className="text-sm font-medium">编辑任务</h4>
      <div className="grid grid-cols-2 gap-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="任务名称" className="px-3 py-2 bg-background border border-border rounded-lg text-sm" />
        <select value={apiKeyId} onChange={(e) => setApiKeyId(e.target.value)} className="px-3 py-2 bg-background border border-border rounded-lg text-sm">
          <option value="">选择 API Key...</option>
          {apiKeys.map((k: any) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
        <select value={model} onChange={(e) => setModel(e.target.value)} className="px-3 py-2 bg-background border border-border rounded-lg text-sm">
          <option value="">选择模型...</option>
          {models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={timeRange} onChange={(e) => setTimeRange(e.target.value)} className="px-3 py-2 bg-background border border-border rounded-lg text-sm">
          <option value="1d">1天</option><option value="3d">3天</option><option value="7d">7天</option><option value="30d">30天</option>
        </select>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">取消</button>
        <button onClick={() => onSave(name, apiKeyId, model, timeRange)} disabled={!name || !apiKeyId || !model} className="px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm disabled:opacity-50">保存</button>
      </div>
    </div>
  );
}

function callerRiskColor(level: string) {
  switch (level) {
    case "极高": return "bg-red-500/20 text-red-400 border-red-500/30";
    case "高": return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    case "中": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    case "低": return "bg-green-500/20 text-green-400 border-green-500/30";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

function callerRiskIcon(level: string) {
  switch (level) {
    case "极高": return <XCircle className="w-4 h-4 text-red-500" />;
    case "高": return <AlertTriangle className="w-4 h-4 text-orange-500" />;
    case "中": return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
    case "低": return <CheckCircle className="w-4 h-4 text-green-500" />;
    default: return <Shield className="w-4 h-4 text-muted-foreground" />;
  }
}

function AnalysisTaskHistory({ taskId }: { taskId: string }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["analysis-task-history", taskId],
    queryFn: async () => {
      const result = await analysisApi.taskHistory(taskId);
      return ((result as any).history || []) as any[];
    },
  });
  const records = data || [];
  if (isLoading) return <div className="text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto" /></div>;
  if (records.length === 0) return <p className="text-xs text-muted-foreground text-center">暂无历史记录</p>;
  return (
    <div className="space-y-2 max-h-64 overflow-y-auto">
      {records.map((r: any) => {
        const hasDetail = (r.detail && r.detail !== "{}" && r.detail !== "") || (r.dimensions && r.dimensions !== "{}" && r.dimensions !== "");
        return (
          <div key={r.id} className="rounded bg-muted/30 text-xs">
            <div className="flex items-start gap-2 p-2">
              <div className="flex-shrink-0 mt-0.5">{callerRiskIcon(r.risk_level)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded ${callerRiskColor(r.risk_level)}`}>{r.risk_level || "未知"}风险</span>
                  <span className="text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(r.run_at).toLocaleString()}</span>
                  {r.duration_ms > 0 && <span className="text-muted-foreground">{(r.duration_ms / 1000).toFixed(1)}s</span>}
                  {(r.logs_analyzed ?? 0) > 0 && <span className="text-muted-foreground">{r.logs_analyzed}条日志</span>}
                  {hasDetail && (
                    <button onClick={() => setExpandedId(expandedId === r.id ? null : r.id)} className="text-primary hover:underline flex items-center gap-0.5">
                      <FileText className="w-3 h-3" />{expandedId === r.id ? "收起" : "详情"}
                    </button>
                  )}
                </div>
                {r.summary && <p className="mt-1 text-muted-foreground">{r.summary}</p>}
              </div>
            </div>
            {expandedId === r.id && hasDetail && (
              <div className="px-2 pb-2 border-t border-border/50">
                {r.dimensions && r.dimensions !== "{}" && r.dimensions !== "" && <DimensionCards dimensionsJson={r.dimensions} />}
                {r.detail && r.detail !== "{}" && r.detail !== "" && (
                  <details className="mt-2" open>
                    <summary className="text-muted-foreground cursor-pointer hover:text-foreground">详细分析报告</summary>
                    <div className="mt-1 p-2 bg-muted/30 rounded whitespace-pre-wrap max-h-48 overflow-y-auto">{r.detail}</div>
                  </details>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CallerProfileAnalysis() {
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [newTask, setNewTask] = useState({
    name: "",
    api_key_id: "",
    model: "",
    time_range: "7d",
    schedule_type: "once",
    interval_minutes: 60,
  });

  const { data: apiKeysData } = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => keysApi.list(),
  });

  const { data: proxyModels } = useQuery({
    queryKey: ["proxy-models"],
    queryFn: () => proxyApi.getModels(),
  });

  const { data: tasksData, refetch: refetchTasks } = useQuery({
    queryKey: ["analysis-tasks"],
    queryFn: async () => {
      const result = await analysisApi.listTasks();
      return ((result as any).tasks || []) as AnalysisTask[];
    },
    refetchInterval: 3000,
  });

  const apiKeys = (apiKeysData?.keys || []).filter((k) => k.active);
  const allModels = proxyModels || [];
  const tasks = tasksData || [];

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ msg: string; fn: () => void } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const clearError = () => setErrorMsg(null);

  const createMutation = useMutation({
    mutationFn: () =>
      analysisApi.createTask({
        name: newTask.name,
        api_key_id: newTask.api_key_id,
        model: newTask.model,
        time_range: newTask.time_range,
        schedule_type: newTask.schedule_type,
        interval_minutes: newTask.interval_minutes,
      }),
    onSuccess: () => {
      setShowCreateForm(false);
      setNewTask({ name: "", api_key_id: "", model: "", time_range: "7d", schedule_type: "once", interval_minutes: 60 });
      refetchTasks();
    },
    onError: (e: any) => { setErrorMsg("创建失败: " + e); },
  });

  const startMutation = useMutation({
    mutationFn: (taskId: string) => analysisApi.startTask(taskId),
    onSuccess: () => refetchTasks(),
    onError: (e: any) => { setErrorMsg("启动失败: " + e); },
  });

  const stopMutation = useMutation({
    mutationFn: (taskId: string) => analysisApi.stopTask(taskId),
    onSuccess: () => refetchTasks(),
    onError: (e: any) => { setErrorMsg("停止失败: " + e); },
  });

  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => analysisApi.deleteTask(taskId),
    onSuccess: () => refetchTasks(),
    onError: (e: any) => { setErrorMsg("删除失败: " + e); },
  });

  const batchDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => analysisApi.deleteTask(id)));
    },
    onSuccess: () => { setSelectedIds(new Set()); refetchTasks(); },
    onError: (e: any) => { setErrorMsg("批量删除失败: " + e); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ taskId, name, apiKeyId, model, timeRange }: { taskId: string; name: string; apiKeyId: string; model: string; timeRange: string }) =>
      analysisApi.updateTask(taskId, { name, api_key_id: apiKeyId, model, time_range: timeRange }),
    onSuccess: () => { refetchTasks(); setEditingTaskId(null); },
    onError: (e: any) => { setErrorMsg("更新失败: " + e); },
  });

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [historyTaskId, setHistoryTaskId] = useState<string | null>(null);

  const getApiKeyName = (id: string) => apiKeys.find((k) => k.id === id)?.name || id;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-4">
        <User className="w-6 h-6 text-primary" />
        <h2 className="text-xl font-bold">调用者行为分析</h2>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => refetchTasks()}
            className="flex items-center gap-1 px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            <Plus className="w-4 h-4" />
            新建任务
          </button>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-red-500/5 border border-red-500/20 rounded-lg">
          <span className="text-sm text-muted-foreground">已选择 {selectedIds.size} 项</span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setSelectedIds(new Set())} className="px-3 py-1 text-xs text-muted-foreground hover:text-foreground">取消选择</button>
            <button
              onClick={() => setConfirmAction({ msg: `确定要删除选中的 ${selectedIds.size} 个任务吗？`, fn: () => batchDeleteMutation.mutate([...selectedIds]) })}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs hover:bg-red-600"
            >
              <Trash2 className="w-3.5 h-3.5" />
              批量删除
            </button>
          </div>
        </div>
      )}

      {showCreateForm && (
        <div className="bg-card rounded-lg border border-border p-4 space-y-4">
          <h4 className="text-sm font-medium">新建分析任务</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">任务名称</label>
              <input
                type="text"
                value={newTask.name}
                onChange={(e) => setNewTask({ ...newTask, name: e.target.value })}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                placeholder="如: 监控主Key调用行为"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">目标 API Key</label>
              <select
                value={newTask.api_key_id}
                onChange={(e) => setNewTask({ ...newTask, api_key_id: e.target.value })}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
              >
                <option value="">选择 Key...</option>
                {apiKeys.map((k) => (
                  <option key={k.id} value={k.id}>{k.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">AI分析模型</label>
              <select
                value={newTask.model}
                onChange={(e) => setNewTask({ ...newTask, model: e.target.value })}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
              >
                <option value="">选择模型...</option>
                {allModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">时间范围</label>
              <select
                value={newTask.time_range}
                onChange={(e) => setNewTask({ ...newTask, time_range: e.target.value })}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
              >
                <option value="1d">最近 1 天</option>
                <option value="3d">最近 3 天</option>
                <option value="7d">最近 7 天</option>
                <option value="30d">最近 30 天</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">执行方式</label>
              <select
                value={newTask.schedule_type}
                onChange={(e) => setNewTask({ ...newTask, schedule_type: e.target.value })}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
              >
                <option value="once">立即执行</option>
                <option value="periodic">定时执行</option>
              </select>
            </div>
            {newTask.schedule_type === "periodic" && (
              <div>
                <label className="block text-sm font-medium mb-1">间隔(分钟)</label>
                <input
                  type="number"
                  value={newTask.interval_minutes}
                  onChange={(e) => setNewTask({ ...newTask, interval_minutes: parseInt(e.target.value) || 60 })}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                  min={5}
                />
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => createMutation.mutate()}
              disabled={!newTask.name || !newTask.api_key_id || !newTask.model || createMutation.isPending}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 text-sm"
            >
              {createMutation.isPending ? "创建中..." : "创建并启动"}
            </button>
            <button
              onClick={() => setShowCreateForm(false)}
              className="px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 text-sm"
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {tasks.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            暂无分析任务，点击"新建任务"创建
          </div>
        )}
        {tasks.map((task) => {
          const statusCfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.idle;
          const isRunning = task.status === "running";
          const riskCard = RISK_CARD[task.result_risk_level || ""];
          const hasDimensions = !!task.result_dimensions;
          const isExpanded = expandedTaskId === task.id;

          return (
            <div key={task.id} className={`bg-card rounded-lg border border-border overflow-hidden ${selectedIds.has(task.id) ? "border-red-500/40" : ""}`}>
              <div className="px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(task.id)) next.delete(task.id);
                        else next.add(task.id);
                        return next;
                      });
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {selectedIds.has(task.id) ? <CheckSquare className="w-4 h-4 text-red-500" /> : <Square className="w-4 h-4" />}
                  </button>
                  <span className="text-xs text-muted-foreground">#{task.task_no}</span>
                  <span className="font-medium text-sm">{task.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${statusCfg.bg} ${statusCfg.text} flex items-center gap-1`}>
                    {isRunning && <Loader2 className="w-3 h-3 animate-spin" />}
                    {statusCfg.label}
                  </span>
                  {task.result_risk_level && riskCard && (
                    <span className={`text-xs px-2 py-0.5 rounded ${riskCard.bg} ${riskCard.text}`}>
                      {task.result_risk_level}风险
                    </span>
                  )}
                  {task.schedule_type === "periodic" && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Repeat className="w-3 h-3" />
                      每{task.interval_minutes}分钟
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {getApiKeyName(task.api_key_id)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {isRunning ? (
                    <button onClick={() => stopMutation.mutate(task.id)} className="p-1.5 text-muted-foreground hover:text-orange-500 rounded" title="停止"><Pause className="w-4 h-4" /></button>
                  ) : (
                    <button onClick={() => startMutation.mutate(task.id)} className="p-1.5 text-muted-foreground hover:text-green-500 rounded" title={task.schedule_type === "periodic" ? "开始" : "执行"}><Play className="w-4 h-4" /></button>
                  )}
                  {!isRunning && task.schedule_type === "once" && (
                    <button onClick={() => { setEditingTaskId(editingTaskId === task.id ? null : task.id); setHistoryTaskId(null); setExpandedTaskId(null); }} className="p-1.5 text-muted-foreground hover:text-foreground rounded" title="编辑"><Pencil className="w-4 h-4" /></button>
                  )}
                  <button onClick={() => { setHistoryTaskId(historyTaskId === task.id ? null : task.id); setEditingTaskId(null); setExpandedTaskId(null); }} className="p-1.5 text-muted-foreground hover:text-foreground rounded" title="历史记录"><History className="w-4 h-4" /></button>
                  {(task.result_detail || hasDimensions) && (
                    <button onClick={() => { setExpandedTaskId(isExpanded ? null : task.id); setEditingTaskId(null); setHistoryTaskId(null); }} className="p-1.5 text-muted-foreground hover:text-foreground rounded" title="查看详情"><FileText className="w-4 h-4" /></button>
                  )}
                  {!isRunning && (
                    <button onClick={() => setConfirmAction({ msg: `确定要删除任务「${task.name}」吗？`, fn: () => deleteMutation.mutate(task.id) })} className="p-1.5 text-muted-foreground hover:text-red-500 rounded" title="删除"><Trash2 className="w-4 h-4" /></button>
                  )}
                </div>
              </div>

              {task.progress && isRunning && (
                <div className="px-4 py-2 border-t border-border bg-blue-500/5 text-xs text-blue-500 flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {task.progress}
                </div>
              )}

              {task.result_summary && (
                <div className="px-4 py-2 border-t border-border bg-muted/20 text-xs text-muted-foreground flex items-center gap-3">
                  <span>{task.result_summary}</span>
                  {task.last_run_at && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(task.last_run_at).toLocaleString("zh-CN")}
                    </span>
                  )}
                  {(task.result_logs_analyzed ?? 0) > 0 && (
                    <span>{task.result_logs_analyzed}条日志</span>
                  )}
                </div>
              )}

              {isExpanded && hasDimensions && (
                <div className="px-4 py-3 border-t border-border">
                  <DimensionCards dimensionsJson={task.result_dimensions!} />
                  {task.result_detail && (
                    <details className="mt-3">
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                        查看详细分析报告
                      </summary>
                      <div className="mt-2 p-2 bg-muted/30 rounded text-xs whitespace-pre-wrap max-h-48 overflow-y-auto">
                        {task.result_detail}
                      </div>
                    </details>
                  )}
                </div>
              )}

              {isExpanded && !hasDimensions && task.result_detail && (
                <div className="px-4 py-3 border-t border-border">
                  <div className="whitespace-pre-wrap text-xs leading-relaxed max-h-64 overflow-y-auto">
                    {task.result_detail}
                  </div>
                </div>
              )}

              {editingTaskId === task.id && (
                <AnalysisEditForm task={task} apiKeys={apiKeys} models={proxyModels || []} onSave={(n, a, m, t) => updateMutation.mutate({ taskId: task.id, name: n, apiKeyId: a, model: m, timeRange: t })} onCancel={() => setEditingTaskId(null)} />
              )}

              {historyTaskId === task.id && (
                <div className="px-4 py-3 border-t border-border">
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-1"><History className="w-4 h-4" />执行历史</h4>
                  <AnalysisTaskHistory taskId={task.id} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {errorMsg && (
        <div className="fixed bottom-4 right-4 z-50 max-w-md bg-red-500/90 text-white px-4 py-3 rounded-lg shadow-lg flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <p className="text-sm flex-1 break-all">{errorMsg}</p>
          <button onClick={clearError} className="text-white/70 hover:text-white text-lg leading-none">&times;</button>
        </div>
      )}

      {confirmAction && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={() => setConfirmAction(null)}>
          <div className="bg-card border border-border rounded-lg p-5 max-w-sm mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm mb-4">{confirmAction.msg}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmAction(null)} className="px-4 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded-lg border border-border">取消</button>
              <button onClick={() => { confirmAction.fn(); setConfirmAction(null); }} className="px-4 py-1.5 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600">确定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

registerSecurityApp({
  id: "caller-profile",
  name: "调用者行为分析",
  description: "创建分析任务，周期性或单次监控 API Key 调用行为模式",
  icon: User,
  component: CallerProfileAnalysis,
  order: 1,
  adminOnly: true,
});

export default CallerProfileAnalysis;
