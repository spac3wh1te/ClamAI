import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/tauri";
import {
  Search,
  FileText,
  Loader2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  FolderSearch,
  Eye,
  Brain,
} from "lucide-react";
import { registerSecurityApp } from "./registry";

interface AgentSession {
  agent_name: string;
  session_path: string;
  messages: AgentMessage[];
  risk_flags: string[];
  message_count: number;
}

interface AgentMessage {
  role: string;
  content: string;
  timestamp?: string;
  model?: string;
}

interface ScanResult {
  agents_found: number;
  sessions: AgentSession[];
  scan_path: string;
  scan_time: string;
}

function AgentLogAuditApp() {
  const [scanPath, setScanPath] = useState("");
  const [selectedSession, setSelectedSession] = useState<AgentSession | null>(
    null,
  );

  const scanMutation = useMutation({
    mutationFn: async (params: { path: string; model?: string }) => {
      const resp = await invoke<string>("scan_agent_logs", {
        scanPath: params.path || "",
        model: params.model || "",
      });
      const parsed = JSON.parse(resp);
      return parsed as ScanResult;
    },
  });

  const { data: proxyModels } = useQuery({
    queryKey: ["proxy-models"],
    queryFn: () => invoke<string[]>("get_proxy_models"),
  });

  const [analysisModel, setAnalysisModel] = useState("");
  const allModels = proxyModels || [];

  const handleScan = () => {
    scanMutation.mutate({ path: scanPath, model: analysisModel });
  };

  const result = scanMutation.data as ScanResult | undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-4">
        <FolderSearch className="w-6 h-6 text-primary" />
        <h2 className="text-xl font-bold">智能体日志审计</h2>
        <span className="text-xs px-2 py-0.5 rounded bg-blue-500/10 text-blue-500">
          PC模式
        </span>
      </div>

      <div className="bg-muted/30 rounded-lg p-4 space-y-4">
        <p className="text-xs text-muted-foreground">
          扫描本机智能体会话日志，发现潜在的异常行为和安全风险。支持扫描 Claude
          Code、Cursor、Windsurf 等主流智能体的会话记录。
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">扫描路径</label>
            <input
              type="text"
              value={scanPath}
              onChange={(e) => setScanPath(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
              placeholder="留空自动扫描默认路径"
            />
            <p className="text-xs text-muted-foreground mt-1">
              如 ~/.claude、~/.cursor 等
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">分析模型</label>
            <select
              value={analysisModel}
              onChange={(e) => setAnalysisModel(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
            >
              <option value="">选择模型（可选）</option>
              {allModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={handleScan}
              disabled={scanMutation.isPending}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              {scanMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              {scanMutation.isPending ? "扫描中..." : "开始扫描"}
            </button>
          </div>
        </div>
      </div>

      {result && (
        <div className="space-y-4">
          <div className="bg-card rounded-lg border border-border p-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">扫描结果</h4>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>路径: {result.scan_path}</span>
                <span>发现 {result.agents_found} 个智能体</span>
                <span>{result.sessions?.length || 0} 个会话</span>
              </div>
            </div>
          </div>

          {result.sessions?.length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              未发现智能体会话日志
            </div>
          )}

          <div className="space-y-2">
            {result.sessions?.map((session, i) => (
              <div
                key={i}
                className="bg-card rounded-lg border border-border overflow-hidden"
              >
                <div className="px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Brain className="w-4 h-4 text-primary" />
                    <span className="font-medium text-sm">
                      {session.agent_name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {session.message_count} 条消息
                    </span>
                    {session.risk_flags?.length > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded bg-orange-500/20 text-orange-400">
                        {session.risk_flags.length} 个风险标记
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() =>
                      setSelectedSession(
                        selectedSession === session ? null : session,
                      )
                    }
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    <Eye className="w-3 h-3" />
                    {selectedSession === session ? "收起" : "查看"}
                  </button>
                </div>
                {session.risk_flags?.length > 0 && (
                  <div className="px-4 py-2 border-t border-border bg-red-500/5">
                    <div className="flex flex-wrap gap-2">
                      {session.risk_flags.map((flag, j) => (
                        <span
                          key={j}
                          className="text-xs px-2 py-0.5 rounded bg-red-500/10 text-red-400"
                        >
                          {flag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {selectedSession === session && (
                  <div className="border-t border-border max-h-80 overflow-y-auto">
                    {session.messages?.map((msg, j) => (
                      <div
                        key={j}
                        className={`px-4 py-2 border-b border-border/50 ${msg.role === "user" ? "bg-muted/20" : ""}`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`text-xs font-medium ${msg.role === "user" ? "text-blue-400" : msg.role === "assistant" ? "text-green-400" : "text-muted-foreground"}`}
                          >
                            {msg.role === "user"
                              ? "用户"
                              : msg.role === "assistant"
                                ? "智能体"
                                : msg.role}
                          </span>
                          {msg.model && (
                            <span className="text-xs text-muted-foreground">
                              {msg.model}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4">
                          {msg.content?.substring(0, 500)}
                          {msg.content?.length > 500 ? "..." : ""}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

registerSecurityApp({
  id: "agent-log-audit",
  name: "智能体日志审计",
  description: "扫描本机智能体会话日志，发现异常行为和安全风险",
  icon: FolderSearch,
  component: AgentLogAuditApp,
  order: 3,
});

export default AgentLogAuditApp;
