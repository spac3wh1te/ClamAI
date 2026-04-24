import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/tauri";
import {
  Shield,
  Upload,
  Link,
  FileText,
  Loader2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Brain,
  Plus,
  Trash2,
  Play,
  RefreshCw,
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
  try {
    dims = JSON.parse(dimensionsJson);
  } catch {
    return null;
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
      {Object.entries(dims).map(([key, val]: [string, any]) => (
        <div key={key} className={`border rounded-lg p-3 ${riskColor(val?.level || "")}`}>
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium text-sm">{DIM_LABELS[key] || key}</span>
            <span className="text-xs font-medium">{val?.level || "未知"}</span>
          </div>
          {val?.description && (
            <p className="text-xs text-muted-foreground mt-1">{val.description}</p>
          )}
        </div>
      ))}
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

  const { data: proxyModels } = useQuery({
    queryKey: ["proxy-models"],
    queryFn: () => invoke<string[]>("get_proxy_models"),
  });

  const { data: tasksData, isLoading } = useQuery({
    queryKey: ["skills-tasks"],
    queryFn: async () => {
      const raw = await invoke<string>("list_skills_tasks");
      const parsed = JSON.parse(raw);
      return (parsed.tasks || []) as SkillsTask[];
    },
    refetchInterval: 3000,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      return invoke<string>("create_skills_task", {
        name: newName,
        model: newModel,
        sourceType,
        sourceInfo,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills-tasks"] });
      setShowCreate(false);
      setNewName("");
      setNewModel("");
      setSourceInfo("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => invoke<string>("delete_skills_task", { id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["skills-tasks"] }),
  });

  const startMutation = useMutation({
    mutationFn: (id: string) => invoke<string>("start_skills_task", { id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["skills-tasks"] }),
  });

  const tasks = tasksData || [];
  const models = proxyModels || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Brain className="w-6 h-6 text-primary" />
        <h2 className="text-xl font-bold">Skills 文档检测</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="ml-auto flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary/90"
        >
          <Plus className="w-4 h-4" />
          新建检测
        </button>
      </div>

      {showCreate && (
        <div className="bg-card rounded-lg border border-border p-4 space-y-3">
          <h3 className="text-sm font-medium">新建检测任务</h3>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="任务名称"
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
          />
          <select
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
          >
            <option value="">选择分析模型...</option>
            {models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <div className="flex gap-2">
            {(["text", "url", "file"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setSourceType(t)}
                className={`flex-1 px-3 py-1.5 rounded-lg text-xs border ${
                  sourceType === t
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-muted"
                }`}
              >
                {t === "text" ? "粘贴文本" : t === "url" ? "URL链接" : "文件路径"}
              </button>
            ))}
          </div>
          {sourceType === "text" ? (
            <textarea
              value={sourceInfo}
              onChange={(e) => setSourceInfo(e.target.value)}
              placeholder="粘贴 Skills 文档内容..."
              className="w-full h-32 px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono resize-none"
            />
          ) : sourceType === "url" ? (
            <input
              value={sourceInfo}
              onChange={(e) => setSourceInfo(e.target.value)}
              placeholder="https://example.com/skills.md"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
            />
          ) : (
            <input
              value={sourceInfo}
              onChange={(e) => setSourceInfo(e.target.value)}
              placeholder="/path/to/skills.md"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono"
            />
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowCreate(false)}
              className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              取消
            </button>
            <button
              onClick={() => createMutation.mutate()}
              disabled={!newName || !newModel || !sourceInfo}
              className="flex items-center gap-1 px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm disabled:opacity-50"
            >
              创建
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          暂无检测任务，点击"新建检测"开始
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <div key={task.id} className="bg-card rounded-lg border border-border p-4">
              <div className="flex items-center gap-3">
                {task.status === "running" ? (
                  <Loader2 className="w-5 h-5 text-primary animate-spin" />
                ) : task.result_risk_level ? (
                  riskIcon(task.result_risk_level)
                ) : (
                  <Shield className="w-5 h-5 text-muted-foreground" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{task.name}</span>
                    <span className="text-xs text-muted-foreground">#{task.task_no}</span>
                    {task.status === "running" && (
                      <span className="text-xs px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded">
                        检测中
                      </span>
                    )}
                    {task.result_risk_level && task.status !== "running" && (
                      <span className={`text-xs px-2 py-0.5 rounded ${riskColor(task.result_risk_level)}`}>
                        {task.result_risk_level}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                                        模型: {task.model} • 来源: {task.source_type}
                    {task.last_run_at && ` • 上次: ${new Date(task.last_run_at).toLocaleString()}`}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {task.status !== "running" && (
                    <button
                      onClick={() => startMutation.mutate(task.id)}
                      className="p-1.5 hover:bg-muted rounded"
                      title="运行检测"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  )}
                  {(task.result_detail || task.result_dimensions) && (
                    <button
                      onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}
                      className="p-1.5 hover:bg-muted rounded"
                      title="查看详情"
                    >
                      <FileText className="w-4 h-4" />
                    </button>
                  )}
                  {task.status !== "running" && (
                    <button
                      onClick={() => deleteMutation.mutate(task.id)}
                      className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-red-500"
                      title="删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {task.status === "running" && task.progress && (
                <div className="mt-2 px-3 py-1.5 bg-blue-500/10 rounded text-xs text-blue-400">
                  {task.progress}
                </div>
              )}

              {task.result_summary && task.status !== "running" && (
                <p className="mt-2 text-sm text-muted-foreground">{task.result_summary}</p>
              )}

              {expandedTask === task.id && (
                <div className="mt-3 border-t border-border pt-3">
                  {task.result_dimensions && (
                    <DimensionCards dimensionsJson={task.result_dimensions} />
                  )}
                  {task.result_detail && (
                    <details className="mt-3">
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                        原始分析结果
                      </summary>
                      <pre className="mt-2 p-3 bg-muted/30 rounded text-xs whitespace-pre-wrap overflow-auto max-h-96">
                        {task.result_detail}
                      </pre>
                    </details>
                  )}
                </div>
              )}
            </div>
          ))}
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
