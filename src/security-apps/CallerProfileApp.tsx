import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/tauri";
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
  Eye,
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

interface ProfileHistoryRecord {
  id: number;
  analyzed_at: string;
  api_key_id: string;
  time_range: string;
  risk_level: string;
  summary: string;
  result: string;
  model_used: string;
  logs_analyzed: number;
}

const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  idle: { bg: "bg-muted", text: "text-muted-foreground", label: "空闲" },
  running: { bg: "bg-blue-500/10", text: "text-blue-500", label: "运行中" },
  error: { bg: "bg-red-500/10", text: "text-red-500", label: "错误" },
};

const RISK_BADGE: Record<string, { bg: string; text: string }> = {
  极高: { bg: "bg-red-500/20", text: "text-red-400" },
  高: { bg: "bg-red-500/20", text: "text-red-400" },
  中: { bg: "bg-orange-500/20", text: "text-orange-400" },
  低: { bg: "bg-green-500/20", text: "text-green-400" },
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

function CallerProfileAnalysis() {
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
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
    queryFn: () => invoke<{ keys: ApiKey[] }>("list_api_keys"),
  });

  const { data: proxyModels } = useQuery({
    queryKey: ["proxy-models"],
    queryFn: () => invoke<string[]>("get_proxy_models"),
  });

  const { data: tasksData, refetch: refetchTasks } = useQuery({
    queryKey: ["analysis-tasks"],
    queryFn: async () => {
      const resp = await invoke<{ tasks: AnalysisTask[] }>("list_analysis_tasks");
      return resp.tasks || [];
    },
    refetchInterval: 3000,
  });

  const { data: historyData, refetch: refetchHistory } = useQuery({
    queryKey: ["profile-history"],
    queryFn: () =>
      invoke<{ records: ProfileHistoryRecord[]; total: number }>(
        "get_profile_analysis_history",
        { limit: 20, offset: 0 },
      ),
    enabled: showHistory,
  });

  const apiKeys = (apiKeysData?.keys || []).filter((k) => k.active);
  const allModels = proxyModels || [];
  const tasks = tasksData || [];

  const createMutation = useMutation({
    mutationFn: () =>
      invoke("create_analysis_task", {
        name: newTask.name,
        apiKeyId: newTask.api_key_id,
        model: newTask.model,
        timeRange: newTask.time_range,
        scheduleType: newTask.schedule_type,
        intervalMinutes: newTask.interval_minutes,
      }),
    onSuccess: () => {
      setShowCreateForm(false);
      setNewTask({ name: "", api_key_id: "", model: "", time_range: "7d", schedule_type: "once", interval_minutes: 60 });
      refetchTasks();
    },
    onError: (e: any) => alert("创建失败: " + e),
  });

  const startMutation = useMutation({
    mutationFn: (taskId: string) => invoke("start_analysis_task", { taskId }),
    onSuccess: () => refetchTasks(),
    onError: (e: any) => alert("启动失败: " + e),
  });

  const stopMutation = useMutation({
    mutationFn: (taskId: string) => invoke("stop_analysis_task", { taskId }),
    onSuccess: () => refetchTasks(),
    onError: (e: any) => alert("停止失败: " + e),
  });

  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => invoke("delete_analysis_task", { taskId }),
    onSuccess: () => refetchTasks(),
    onError: (e: any) => alert("删除失败: " + e),
  });

  const getApiKeyName = (id: string) => apiKeys.find((k) => k.id === id)?.name || id;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-4">
        <User className="w-6 h-6 text-primary" />
        <h2 className="text-xl font-bold">调用者行为分析</h2>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-1 px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <History className="w-4 h-4" />
            {showHistory ? "隐藏历史" : "历史记录"}
          </button>
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

      {showHistory && (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h4 className="text-sm font-medium">分析历史</h4>
          </div>
          <div className="divide-y divide-border max-h-72 overflow-y-auto">
            {historyData?.records?.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">暂无记录</div>
            )}
            {historyData?.records?.map((r) => (
              <div key={r.id} className="px-4 py-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${(RISK_BADGE[r.risk_level] || { bg: "bg-muted", text: "text-muted-foreground" }).bg} ${(RISK_BADGE[r.risk_level] || { bg: "", text: "text-muted-foreground" }).text}`}>
                      {r.risk_level || "未知"}
                    </span>
                    <span className="text-xs text-muted-foreground">{r.model_used}</span>
                    <span className="text-xs text-muted-foreground">{r.time_range}</span>
                    <span className="text-xs text-muted-foreground">{r.logs_analyzed} 条日志</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(r.analyzed_at).toLocaleString("zh-CN")}
                  </span>
                </div>
                {r.summary && <p className="text-xs text-muted-foreground mt-1">{r.summary}</p>}
              </div>
            ))}
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
          const riskBadge = RISK_BADGE[task.result_risk_level || ""];
          const hasDimensions = !!task.result_dimensions;
          const isExpanded = expandedTaskId === task.id;

          return (
            <div key={task.id} className="bg-card rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-muted-foreground">{task.task_no}</span>
                  <span className="font-medium text-sm">{task.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${statusCfg.bg} ${statusCfg.text} flex items-center gap-1`}>
                    {isRunning && <Loader2 className="w-3 h-3 animate-spin" />}
                    {statusCfg.label}
                  </span>
                  {task.result_risk_level && riskBadge && (
                    <span className={`text-xs px-2 py-0.5 rounded ${riskBadge.bg} ${riskBadge.text}`}>
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
                  <button
                    onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                    className="text-xs text-primary hover:underline px-2 flex items-center gap-1"
                  >
                    <Eye className="w-3 h-3" />
                    {isExpanded ? "收起" : hasDimensions ? "维度详情" : "详情"}
                  </button>
                  {!isRunning && task.schedule_type === "once" && (
                    <button
                      onClick={() => startMutation.mutate(task.id)}
                      className="p-1.5 text-muted-foreground hover:text-green-500"
                      title="执行"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  )}
                  {isRunning && task.schedule_type === "periodic" && (
                    <button
                      onClick={() => stopMutation.mutate(task.id)}
                      className="p-1.5 text-muted-foreground hover:text-orange-500"
                      title="暂停"
                    >
                      <Pause className="w-4 h-4" />
                    </button>
                  )}
                  {!isRunning && task.schedule_type === "periodic" && (
                    <button
                      onClick={() => startMutation.mutate(task.id)}
                      className="p-1.5 text-muted-foreground hover:text-green-500"
                      title="开始"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  )}
                  {!isRunning && (
                    <button
                      onClick={() => { if (confirm("确定要删除此任务吗？")) deleteMutation.mutate(task.id); }}
                      className="p-1.5 text-muted-foreground hover:text-red-500"
                      title="删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
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
            </div>
          );
        })}
      </div>
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
});

export default CallerProfileAnalysis;
