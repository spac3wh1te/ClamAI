import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { analysisApi } from "../../api/analysis";
import { proxyApi } from "../../api/stats";
import {
  Shield,
  FileText,
  Loader2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Brain,
  Plus,
  Trash2,
  Play,
  Pause,
  RefreshCw,
  Pencil,
  History,
  Clock,
  ChevronDown,
  ChevronUp,
  CheckSquare,
  Square,
} from "lucide-react";
import { registerSecurityApp } from "./registry";

interface SkillsTask {
  id: string;
  task_no: string;
  name: string;
  model: string;
  source_type: string;
  source_info: string;
  schedule_type: string;
  status: string;
  progress?: string;
  last_run_at?: string;
  created_at: string;
  result_risk_level?: string;
  result_summary?: string;
  result_detail?: string;
  result_dimensions?: string;
}

interface HistoryRecord {
  id: number;
  risk_level: string;
  summary: string;
  detail: string;
  dimensions: string;
  status: string;
  duration_ms: number;
  run_at: string;
}

const DIM_LABELS: Record<string, string> = {
  malicious_instructions: "恶意指令注入",
  data_poisoning: "数据投毒",
  privacy_leak: "隐私泄露",
  backdoor: "后门植入",
  misinformation: "虚假信息",
  prompt_injection: "提示词注入",
};

function riskColor(level: string) {
  switch (level) {
    case "极高": return "bg-red-500/20 text-red-400 border-red-500/30";
    case "高": return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    case "中": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    case "低": return "bg-green-500/20 text-green-400 border-green-500/30";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

function riskIcon(level: string) {
  switch (level) {
    case "极高": return <XCircle className="w-5 h-5 text-red-500" />;
    case "高": return <AlertTriangle className="w-5 h-5 text-orange-500" />;
    case "中": return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
    case "低": return <CheckCircle className="w-5 h-5 text-green-500" />;
    default: return <Shield className="w-5 h-5 text-muted-foreground" />;
  }
}

function DimensionCards({ dimensionsJson }: { dimensionsJson: string }) {
  let dims: Record<string, any> = {};
  try { dims = JSON.parse(dimensionsJson); } catch { return null; }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
      {Object.entries(dims).map(([key, val]: [string, any]) => (
        <div key={key} className={`border rounded-lg p-3 ${riskColor(val?.level || "")}`}>
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium text-sm">{DIM_LABELS[key] || key}</span>
            <span className="text-xs font-medium">{val?.level || "未知"}</span>
          </div>
          {val?.description && <p className="text-xs text-muted-foreground mt-1">{val.description}</p>}
        </div>
      ))}
    </div>
  );
}

function TaskEditForm({ task, models, onSave, onCancel }: {
  task: SkillsTask; models: string[]; onSave: (name: string, model: string, sourceType: string, sourceInfo: string) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(task.name);
  const [model, setModel] = useState(task.model);
  const [sourceType, setSourceType] = useState<"text" | "url" | "file">(task.source_type as "text" | "url" | "file" || "text");
  const [sourceInfo, setSourceInfo] = useState(task.source_info);
  return (
    <div className="mt-3 border-t border-border pt-3 space-y-3">
      <h4 className="text-sm font-medium">编辑任务</h4>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="任务名称" className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" />
      <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm">
        <option value="">选择模型...</option>
        {models.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <div className="flex gap-2">
        {(["text", "url", "file"] as const).map((t) => (
          <button key={t} onClick={() => setSourceType(t)} className={`flex-1 px-3 py-1.5 rounded-lg text-xs border ${sourceType === t ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted"}`}>
            {t === "text" ? "粘贴文本" : t === "url" ? "URL" : "文件"}
          </button>
        ))}
      </div>
      {sourceType === "text" ? (
        <textarea value={sourceInfo} onChange={(e) => setSourceInfo(e.target.value)} className="w-full h-24 px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono resize-none" />
      ) : (
        <input value={sourceInfo} onChange={(e) => setSourceInfo(e.target.value)} placeholder={sourceType === "url" ? "https://..." : "/path/to/file"} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" />
      )}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">取消</button>
        <button onClick={() => onSave(name, model, sourceType, sourceInfo)} disabled={!name || !model} className="px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm disabled:opacity-50">保存</button>
      </div>
    </div>
  );
}

function TaskHistory({ taskId }: { taskId: string }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["skills-task-history", taskId],
    queryFn: async () => {
      const result = await analysisApi.skillsTaskHistory(taskId);
      return ((result as any).history || []) as HistoryRecord[];
    },
  });
  const records = data || [];
  if (isLoading) return <div className="mt-3 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto" /></div>;
  if (records.length === 0) return <p className="mt-3 text-xs text-muted-foreground text-center">暂无历史记录</p>;
  return (
    <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
      {records.map((r) => {
        const hasDetail = (r.detail && r.detail !== "{}" && r.detail !== "") || (r.dimensions && r.dimensions !== "{}" && r.dimensions !== "");
        return (
          <div key={r.id} className="rounded bg-muted/30 text-xs">
            <div className="flex items-start gap-3 p-2">
              <div className="flex-shrink-0 mt-0.5">{riskIcon(r.risk_level)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded ${riskColor(r.risk_level)}`}>{r.risk_level || "未知"}</span>
                  <span className="text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(r.run_at).toLocaleString()}</span>
                  {r.duration_ms > 0 && <span className="text-muted-foreground">{(r.duration_ms / 1000).toFixed(1)}s</span>}
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
                    <summary className="text-muted-foreground cursor-pointer hover:text-foreground">原始分析结果</summary>
                    <pre className="mt-1 p-2 bg-muted/30 rounded whitespace-pre-wrap overflow-auto max-h-48">{r.detail}</pre>
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

function SkillsDetection() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newModel, setNewModel] = useState("");
  const [sourceType, setSourceType] = useState<"text" | "url" | "file">("text");
  const [sourceInfo, setSourceInfo] = useState("");
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<string | null>(null);
  const [historyTask, setHistoryTask] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ msg: string; fn: () => void } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: proxyModels } = useQuery({
    queryKey: ["proxy-models"],
    queryFn: () => proxyApi.getModels(),
  });

  const { data: tasksData, isLoading } = useQuery({
    queryKey: ["skills-tasks"],
    queryFn: async () => {
      const result = await analysisApi.listSkillsTasks();
      return ((result as any).tasks || []) as SkillsTask[];
    },
    refetchInterval: 3000,
  });

  const createMutation = useMutation({
    mutationFn: async () => analysisApi.createSkillsTask({ name: newName, model: newModel, source_type: sourceType, source_info: sourceInfo }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["skills-tasks"] }); setShowCreate(false); setNewName(""); setNewModel(""); setSourceInfo(""); },
    onError: (e: any) => { setErrorMsg("创建失败: " + e); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => analysisApi.deleteSkillsTask(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["skills-tasks"] }),
    onError: (e: any) => { setErrorMsg("删除失败: " + e); },
  });

  const batchDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => analysisApi.deleteSkillsTask(id)));
    },
    onSuccess: () => { setSelectedIds(new Set()); queryClient.invalidateQueries({ queryKey: ["skills-tasks"] }); },
    onError: (e: any) => { setErrorMsg("批量删除失败: " + e); },
  });

  const startMutation = useMutation({
    mutationFn: (id: string) => analysisApi.startSkillsTask(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["skills-tasks"] }),
    onError: (e: any) => { setErrorMsg("启动失败: " + e); },
  });

  const stopMutation = useMutation({
    mutationFn: (id: string) => analysisApi.stopSkillsTask(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["skills-tasks"] }),
    onError: (e: any) => { setErrorMsg("停止失败: " + e); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, name, model, sourceType, sourceInfo }: { id: string; name: string; model: string; sourceType: string; sourceInfo: string }) =>
      analysisApi.updateSkillsTask(id, { name, model, source_type: sourceType, source_info: sourceInfo }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["skills-tasks"] }); setEditingTask(null); },
    onError: (e: any) => { setErrorMsg("更新失败: " + e); },
  });

  const tasks = tasksData || [];
  const models = proxyModels || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Brain className="w-6 h-6 text-primary" />
        <h2 className="text-xl font-bold">Skills 文档检测</h2>
        <button onClick={() => setShowCreate(true)} className="ml-auto flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary/90">
          <Plus className="w-4 h-4" />新建检测
        </button>
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

      {showCreate && (
        <div className="bg-card rounded-lg border border-border p-4 space-y-3">
          <h3 className="text-sm font-medium">新建检测任务</h3>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="任务名称" className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" />
          <select value={newModel} onChange={(e) => setNewModel(e.target.value)} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm">
            <option value="">选择分析模型...</option>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <div className="flex gap-2">
            {(["text", "url", "file"] as const).map((t) => (
              <button key={t} onClick={() => setSourceType(t)} className={`flex-1 px-3 py-1.5 rounded-lg text-xs border ${sourceType === t ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted"}`}>
                {t === "text" ? "粘贴文本" : t === "url" ? "URL链接" : "文件路径"}
              </button>
            ))}
          </div>
          {sourceType === "text" ? (
            <textarea value={sourceInfo} onChange={(e) => setSourceInfo(e.target.value)} placeholder="粘贴 Skills 文档内容..." className="w-full h-32 px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono resize-none" />
          ) : sourceType === "url" ? (
            <input value={sourceInfo} onChange={(e) => setSourceInfo(e.target.value)} placeholder="https://example.com/skills.md" className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" />
          ) : (
            <input value={sourceInfo} onChange={(e) => setSourceInfo(e.target.value)} placeholder="/path/to/skills.md" className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono" />
          )}
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">取消</button>
            <button onClick={() => createMutation.mutate()} disabled={!newName || !newModel || !sourceInfo} className="flex items-center gap-1 px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm disabled:opacity-50">创建</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">暂无检测任务，点击"新建检测"开始</div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <div key={task.id} className={`bg-card rounded-lg border border-border p-4 ${selectedIds.has(task.id) ? "border-red-500/40" : ""}`}>
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
                {task.status === "running" ? <Loader2 className="w-5 h-5 text-primary animate-spin" /> : task.result_risk_level ? riskIcon(task.result_risk_level) : <Shield className="w-5 h-5 text-muted-foreground" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{task.name}</span>
                    <span className="text-xs text-muted-foreground">#{task.task_no}</span>
                    {task.status === "running" && <span className="text-xs px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded">检测中</span>}
                    {task.result_risk_level && task.status !== "running" && <span className={`text-xs px-2 py-0.5 rounded ${riskColor(task.result_risk_level)}`}>{task.result_risk_level}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    模型: {task.model} &bull; 来源: {task.source_type}
                    {task.last_run_at && ` \u2022 上次: ${new Date(task.last_run_at).toLocaleString()}`}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {task.status !== "running" && (
                    <button onClick={() => startMutation.mutate(task.id)} className="p-1.5 text-muted-foreground hover:text-green-500 rounded" title="运行检测"><Play className="w-4 h-4" /></button>
                  )}
                  {task.status === "running" && (
                    <button onClick={() => stopMutation.mutate(task.id)} className="p-1.5 text-muted-foreground hover:text-orange-500 rounded" title="停止"><Pause className="w-4 h-4" /></button>
                  )}
                  {task.status !== "running" && (
                    <button onClick={() => { setEditingTask(editingTask === task.id ? null : task.id); setHistoryTask(null); setExpandedTask(null); }} className="p-1.5 text-muted-foreground hover:text-foreground rounded" title="编辑"><Pencil className="w-4 h-4" /></button>
                  )}
                  <button onClick={() => { setHistoryTask(historyTask === task.id ? null : task.id); setEditingTask(null); setExpandedTask(null); }} className="p-1.5 text-muted-foreground hover:text-foreground rounded" title="历史记录"><History className="w-4 h-4" /></button>
                  {(task.result_detail || task.result_dimensions) && (
                    <button onClick={() => { setExpandedTask(expandedTask === task.id ? null : task.id); setEditingTask(null); setHistoryTask(null); }} className="p-1.5 text-muted-foreground hover:text-foreground rounded" title="查看详情"><FileText className="w-4 h-4" /></button>
                  )}
                  {task.status !== "running" && (
                    <button onClick={() => setConfirmAction({ msg: `确定要删除任务「${task.name}」吗？`, fn: () => deleteMutation.mutate(task.id) })} className="p-1.5 text-muted-foreground hover:text-red-500 rounded" title="删除"><Trash2 className="w-4 h-4" /></button>
                  )}
                </div>
              </div>

              {task.status === "running" && task.progress && (
                <div className="mt-2 px-3 py-1.5 bg-blue-500/10 rounded text-xs text-blue-400">{task.progress}</div>
              )}
              {task.result_summary && task.status !== "running" && <p className="mt-2 text-sm text-muted-foreground">{task.result_summary}</p>}

              {editingTask === task.id && (
                <TaskEditForm task={task} models={models} onSave={(n, m, st, si) => updateMutation.mutate({ id: task.id, name: n, model: m, sourceType: st, sourceInfo: si })} onCancel={() => setEditingTask(null)} />
              )}

              {historyTask === task.id && (
                <div className="mt-3 border-t border-border pt-3">
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-1"><History className="w-4 h-4" />执行历史</h4>
                  <TaskHistory taskId={task.id} />
                </div>
              )}

              {expandedTask === task.id && (
                <div className="mt-3 border-t border-border pt-3">
                  {task.result_dimensions && <DimensionCards dimensionsJson={task.result_dimensions} />}
                  {task.result_detail && (
                    <details className="mt-3">
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">原始分析结果</summary>
                      <pre className="mt-2 p-3 bg-muted/30 rounded text-xs whitespace-pre-wrap overflow-auto max-h-96">{task.result_detail}</pre>
                    </details>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {errorMsg && (
        <div className="fixed bottom-4 right-4 z-50 max-w-md bg-red-500/90 text-white px-4 py-3 rounded-lg shadow-lg flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <p className="text-sm flex-1 break-all">{errorMsg}</p>
          <button onClick={() => setErrorMsg(null)} className="text-white/70 hover:text-white text-lg leading-none">&times;</button>
        </div>
      )}

      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmAction(null)}>
          <div className="bg-card rounded-lg border border-border p-6 max-w-sm mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm mb-4">{confirmAction.msg}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmAction(null)} className="px-3 py-1.5 text-sm bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80">取消</button>
              <button onClick={() => { confirmAction.fn(); setConfirmAction(null); }} className="px-3 py-1.5 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600">删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

registerSecurityApp({
  id: "skills-detection",
  name: "Skills 文档检测",
  description: "检测 AI Agent Skills 文档中的安全风险",
  icon: Brain,
  component: SkillsDetection,
  order: 2,
});

export default SkillsDetection;
