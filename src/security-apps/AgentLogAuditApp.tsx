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
  RefreshCw,
  ChevronRight,
  ChevronDown,
  AlertCircle,
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
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const { data: proxyModels } = useQuery({
    queryKey: ["proxy-models"],
    queryFn: () => invoke<string[]>("get_proxy_models"),
  });

  const scanMutation = useMutation({
    mutationFn: async () => {
      const resp = await invoke<string>("scan_agent_logs", {
        scanPath: "",
        model: selectedModel,
      });
      const parsed = JSON.parse(resp);
      return parsed as ScanResult;
    },
  });

  const { data: agentsData } = useQuery({
    queryKey: ["discover-agents"],
    queryFn: async () => {
      const raw = await invoke<string>("discover_agents");
      const parsed = JSON.parse(raw);
      return parsed.agents || [];
    },
  });

  const result = scanMutation.data;
  const models = proxyModels || [];

  const groupedSessions: Record<string, AgentSession[]> = {};
  if (result?.sessions) {
    for (const s of result.sessions) {
      const name = s.agent_name || "unknown";
      if (!groupedSessions[name]) groupedSessions[name] = [];
      groupedSessions[name].push(s);
    }
  }

  const agentStatuses = agentsData as Array<{
    name: string;
    dir: string;
    session_count: number;
    has_skills?: boolean;
  }> | undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <FolderSearch className="w-6 h-6 text-primary" />
        <h2 className="text-xl font-bold">智能体日志审计</h2>
      </div>

      {agentStatuses && agentStatuses.length > 0 && (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-sm font-medium">已发现的智能体</span>
          </div>
          <div className="divide-y divide-border">
            {agentStatuses.map((a) => (
              <div key={a.name} className="px-4 py-2 flex items-center gap-3">
                <Brain className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">{a.name}</span>
                <span className="text-xs text-muted-foreground">
                  {a.session_count} 个会话文件
                </span>
                {a.has_skills && (
                  <span className="text-xs px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded">Skills</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-muted/30 rounded-lg p-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          自动扫描本机智能体会话日志，发现异常行为和安全风险。
        </p>
        <div className="flex items-center gap-3">
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="px-3 py-2 bg-background border border-border rounded-lg text-sm"
          >
            <option value="">无AI分析</option>
            {models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 text-sm"
          >
            {scanMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            {scanMutation.isPending ? "扫描中..." : "开始扫描"}
          </button>
          {result && (
            <button
              onClick={() => scanMutation.mutate()}
              className="flex items-center gap-1 px-3 py-2 bg-secondary text-secondary-foreground rounded-lg text-sm"
            >
              <RefreshCw className="w-4 h-4" />
              重新扫描
            </button>
          )}
        </div>
      </div>

      {result && (
        <div className="space-y-3">
          <div className="bg-card rounded-lg border border-border p-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>发现 {result.agents_found} 个智能体 · {result.sessions?.length || 0} 个会话</span>
            <span>{new Date(result.scan_time).toLocaleString("zh-CN")}</span>
          </div>

          {Object.keys(groupedSessions).length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              未发现智能体会话日志
            </div>
          )}

          {Object.entries(groupedSessions).map(([agentName, sessions]) => {
            const isExpanded = expandedAgent === agentName;
            const totalRiskFlags = sessions.reduce((sum, s) => sum + (s.risk_flags?.length || 0), 0);
            return (
              <div key={agentName} className="bg-card rounded-lg border border-border overflow-hidden">
                <div
                  className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-muted/30"
                  onClick={() => setExpandedAgent(isExpanded ? null : agentName)}
                >
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  )}
                  <Brain className="w-5 h-5 text-primary" />
                  <span className="font-medium text-sm">{agentName}</span>
                  <span className="text-xs text-muted-foreground">{sessions.length} 个会话</span>
                  {totalRiskFlags > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400">
                      {totalRiskFlags} 个风险
                    </span>
                  )}
                </div>

                {isExpanded && (
                  <div className="border-t border-border">
                    {sessions.map((session, i) => {
                      const isOpen = selectedSession === `${agentName}-${i}`;
                      return (
                        <div key={i} className="border-b border-border/50 last:border-b-0">
                          <div
                            className="px-4 py-2.5 flex items-center gap-3 hover:bg-muted/20 cursor-pointer"
                            onClick={() => setSelectedSession(isOpen ? null : `${agentName}-${i}`)}
                          >
                            <FileText className="w-4 h-4 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground truncate flex-1">
                              {session.session_path}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {session.message_count} 条消息
                            </span>
                            {session.risk_flags?.length > 0 && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400">
                                {session.risk_flags.length} 风险
                              </span>
                            )}
                            <Eye className="w-3 h-3 text-muted-foreground" />
                          </div>

                          {session.risk_flags?.length > 0 && (
                            <div className="px-4 py-1.5 bg-red-500/5">
                              <div className="flex flex-wrap gap-1">
                                {session.risk_flags.map((flag, j) => (
                                  <span
                                    key={j}
                                    className="text-xs px-1.5 py-0.5 rounded bg-red-500/10 text-red-400"
                                  >
                                    {flag}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {isOpen && (
                            <div className="max-h-72 overflow-y-auto bg-muted/10">
                              {session.messages?.map((msg, j) => (
                                <div
                                  key={j}
                                  className={`px-4 py-2 border-b border-border/30 ${msg.role === "user" ? "bg-blue-500/5" : ""}`}
                                >
                                  <div className="flex items-center gap-2 mb-1">
                                    <span
                                      className={`text-xs font-medium ${
                                        msg.role === "user"
                                          ? "text-blue-400"
                                          : msg.role === "assistant"
                                            ? "text-green-400"
                                            : "text-muted-foreground"
                                      }`}
                                    >
                                      {msg.role === "user" ? "用户" : msg.role === "assistant" ? "智能体" : msg.role}
                                    </span>
                                    {msg.model && (
                                      <span className="text-xs text-muted-foreground">{msg.model}</span>
                                    )}
                                    {msg.timestamp && (
                                      <span className="text-xs text-muted-foreground">
                                        {new Date(msg.timestamp).toLocaleString("zh-CN")}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-6">
                                    {msg.content?.substring(0, 800)}
                                    {msg.content?.length > 800 ? "..." : ""}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

registerSecurityApp({
  id: "agent-log-audit",
  name: "智能体日志审计",
  description: "自动发现智能体，扫描会话日志，发现异常行为和安全风险",
  icon: FolderSearch,
  component: AgentLogAuditApp,
  order: 3,
});

export default AgentLogAuditApp;
