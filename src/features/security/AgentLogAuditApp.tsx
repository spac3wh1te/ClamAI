import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { agentApi } from "../../api/analysis";
import { proxyApi } from "../../api/stats";
import {
  Search,
  FileText,
  Loader2,
  AlertTriangle,
  FolderSearch,
  Brain,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Filter,
  X,
  ArrowUpDown,
  HardDrive,
  MessageSquare,
  AlertCircle,
} from "lucide-react";
import { registerSecurityApp } from "./registry";

interface AgentMessage {
  role: string;
  content: string;
  timestamp?: string;
  model?: string;
}

interface AgentSession {
  agent_name: string;
  session_path: string;
  messages: AgentMessage[];
  risk_flags: string[];
  message_count: number;
  file_size: number;
}

interface ScanResult {
  agents_found: number;
  sessions: AgentSession[];
  scan_path: string;
  scan_time: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function riskColor(count: number): string {
  if (count === 0) return "text-green-400";
  if (count <= 2) return "text-yellow-400";
  return "text-red-400";
}

function AgentLogAuditApp() {
  const [selectedModel, setSelectedModel] = useState("");
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"name" | "size" | "messages" | "risks">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const { data: proxyModels } = useQuery({
    queryKey: ["proxy-models"],
    queryFn: () => proxyApi.getModels(),
  });

  const scanMutation = useMutation({
    mutationFn: async () => {
      return (await agentApi.scanLogs({
        log_path: "",
        patterns: selectedModel ? [selectedModel] : [],
      })) as unknown as ScanResult;
    },
  });

  const result = scanMutation.data;
  const models = proxyModels || [];

  const groupedSessions = useMemo(() => {
    if (!result?.sessions) return {};
    const groups: Record<string, AgentSession[]> = {};
    for (const s of result.sessions) {
      const name = s.agent_name || "unknown";
      if (!groups[name]) groups[name] = [];
      groups[name].push(s);
    }
    return groups;
  }, [result]);

  const agentStats = useMemo(() => {
    const stats: Record<string, { totalMessages: number; totalSize: number; totalRisks: number }> = {};
    for (const [name, sessions] of Object.entries(groupedSessions)) {
      stats[name] = {
        totalMessages: sessions.reduce((s, x) => s + x.message_count, 0),
        totalSize: sessions.reduce((s, x) => s + x.file_size, 0),
        totalRisks: sessions.reduce((s, x) => s + (x.risk_flags?.length || 0), 0),
      };
    }
    return stats;
  }, [groupedSessions]);

  const filteredMessages = useMemo(() => {
    if (!expandedSession || !result?.sessions) return [];
    const session = result.sessions.find((s) => s.session_path === expandedSession);
    if (!session) return [];
    let msgs = session.messages || [];
    if (roleFilter !== "all") {
      msgs = msgs.filter((m) => m.role === roleFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      msgs = msgs.filter(
        (m) =>
          m.content?.toLowerCase().includes(q) ||
          m.model?.toLowerCase().includes(q)
      );
    }
    return msgs;
  }, [expandedSession, result, roleFilter, searchQuery]);

  const sortedAgentNames = useMemo(() => {
    const names = Object.keys(groupedSessions);
    const dir = sortDir === "asc" ? 1 : -1;
    return names.sort((a, b) => {
      const sa = agentStats[a];
      const sb = agentStats[b];
      switch (sortBy) {
        case "size":
          return dir * (sa.totalSize - sb.totalSize);
        case "messages":
          return dir * (sa.totalMessages - sb.totalMessages);
        case "risks":
          return dir * (sa.totalRisks - sb.totalRisks);
        default:
          return dir * a.localeCompare(b);
      }
    });
  }, [groupedSessions, agentStats, sortBy, sortDir]);

  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ col }: { col: typeof sortBy }) => (
    <ArrowUpDown
      className={`w-3 h-3 inline ml-0.5 ${sortBy === col ? "text-primary" : "text-muted-foreground/50"}`}
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <FolderSearch className="w-6 h-6 text-primary" />
        <h2 className="text-xl font-bold">智能体日志审计</h2>
      </div>

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
            <option value="">不使用AI分析</option>
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
              onClick={() => {
                setExpandedAgent(null);
                setExpandedSession(null);
                scanMutation.mutate();
              }}
              disabled={scanMutation.isPending}
              className="flex items-center gap-1 px-3 py-2 bg-secondary text-secondary-foreground rounded-lg text-sm hover:bg-secondary/80 disabled:opacity-50"
            >
              <RefreshCw className="w-4 h-4" />
              重新扫描
            </button>
          )}
        </div>
      </div>

      {result && (
        <div className="space-y-4">
          <div className="bg-card rounded-lg border border-border p-3 flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-4">
              <span>发现 {result.agents_found} 个智能体 · {result.sessions?.length || 0} 个会话</span>
              {result.sessions && result.sessions.length > 0 && (
                <>
                  <span className="flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" />
                    {result.sessions.reduce((s, x) => s + x.message_count, 0)} 条消息
                  </span>
                  <span className="flex items-center gap-1">
                    <HardDrive className="w-3 h-3" />
                    {formatFileSize(result.sessions.reduce((s, x) => s + x.file_size, 0))}
                  </span>
                </>
              )}
            </div>
            <span>{new Date(result.scan_time).toLocaleString("zh-CN")}</span>
          </div>

          {sortedAgentNames.length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              未发现智能体会话日志
            </div>
          )}

          {sortedAgentNames.length > 0 && (
            <div className="bg-card rounded-lg border border-border overflow-hidden">
              <div className="grid grid-cols-[1fr_80px_80px_80px_60px] gap-2 px-4 py-2 border-b border-border text-xs text-muted-foreground">
                <button onClick={() => toggleSort("name")} className="text-left hover:text-foreground">
                  智能体 <SortIcon col="name" />
                </button>
                <button onClick={() => toggleSort("messages")} className="text-right hover:text-foreground">
                  消息 <SortIcon col="messages" />
                </button>
                <button onClick={() => toggleSort("size")} className="text-right hover:text-foreground">
                  大小 <SortIcon col="size" />
                </button>
                <button onClick={() => toggleSort("risks")} className="text-right hover:text-foreground">
                  风险 <SortIcon col="risks" />
                </button>
                <span className="text-right">会话</span>
              </div>
              <div className="divide-y divide-border">
                {sortedAgentNames.map((agentName) => {
                  const sessions = groupedSessions[agentName];
                  const stats = agentStats[agentName];
                  const isExpanded = expandedAgent === agentName;
                  return (
                    <div key={agentName}>
                      <div
                        className="grid grid-cols-[1fr_80px_80px_80px_60px] gap-2 px-4 py-3 items-center cursor-pointer hover:bg-muted/30"
                        onClick={() => {
                          setExpandedAgent(isExpanded ? null : agentName);
                          setExpandedSession(null);
                        }}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          )}
                          <Brain className="w-4 h-4 text-primary flex-shrink-0" />
                          <span className="font-medium text-sm truncate">{agentName}</span>
                        </div>
                        <span className="text-xs text-muted-foreground text-right">{stats.totalMessages}</span>
                        <span className="text-xs text-muted-foreground text-right">{formatFileSize(stats.totalSize)}</span>
                        <span className={`text-xs text-right ${riskColor(stats.totalRisks)}`}>
                          {stats.totalRisks > 0 && <AlertTriangle className="w-3 h-3 inline mr-0.5" />}
                          {stats.totalRisks}
                        </span>
                        <span className="text-xs text-muted-foreground text-right">{sessions.length}</span>
                      </div>

                      {isExpanded && (
                        <div className="border-t border-border bg-muted/10">
                          {sessions
                            .sort((a, b) => b.file_size - a.file_size)
                            .map((session, i) => {
                              const isSessionOpen = expandedSession === session.session_path;
                              return (
                                <div key={i} className="border-b border-border/50 last:border-b-0">
                                  <div
                                    className="px-4 py-2.5 flex items-center gap-3 hover:bg-muted/20 cursor-pointer"
                                    onClick={() => {
                                      setExpandedSession(isSessionOpen ? null : session.session_path);
                                      setSearchQuery("");
                                      setRoleFilter("all");
                                    }}
                                  >
                                    {isSessionOpen ? (
                                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                                    ) : (
                                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                                    )}
                                    <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                    <span className="text-xs text-muted-foreground truncate flex-1" title={session.session_path}>
                                      {session.session_path}
                                    </span>
                                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                                      {session.message_count} 条
                                    </span>
                                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                                      {formatFileSize(session.file_size)}
                                    </span>
                                    {session.risk_flags?.length > 0 && (
                                      <span className="text-xs px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 whitespace-nowrap">
                                        {session.risk_flags.length} 风险
                                      </span>
                                    )}
                                  </div>

                                  {session.risk_flags?.length > 0 && !isSessionOpen && (
                                    <div className="px-4 pb-2 pl-12">
                                      <div className="flex flex-wrap gap-1">
                                        {session.risk_flags.slice(0, 3).map((flag, j) => (
                                          <span
                                            key={j}
                                            className="text-xs px-1.5 py-0.5 rounded bg-red-500/10 text-red-400"
                                          >
                                            {flag}
                                          </span>
                                        ))}
                                        {session.risk_flags.length > 3 && (
                                          <span className="text-xs text-muted-foreground">
                                            +{session.risk_flags.length - 3} 更多
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  )}

                                  {isSessionOpen && (
                                    <div className="border-t border-border/30">
                                      <div className="px-4 py-2 flex items-center gap-2 flex-wrap bg-muted/20 border-b border-border/30">
                                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                          <Filter className="w-3 h-3" />
                                          <select
                                            value={roleFilter}
                                            onChange={(e) => setRoleFilter(e.target.value)}
                                            className="px-2 py-1 bg-background border border-border rounded text-xs"
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            <option value="all">全部角色</option>
                                            <option value="user">用户</option>
                                            <option value="assistant">智能体</option>
                                            <option value="system">系统</option>
                                          </select>
                                        </div>
                                        <div className="flex items-center gap-1 flex-1 min-w-[200px]">
                                          <Search className="w-3 h-3 text-muted-foreground" />
                                          <input
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            placeholder="搜索消息内容..."
                                            className="flex-1 px-2 py-1 bg-background border border-border rounded text-xs"
                                            onClick={(e) => e.stopPropagation()}
                                          />
                                          {searchQuery && (
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setSearchQuery("");
                                              }}
                                              className="p-0.5 text-muted-foreground hover:text-foreground"
                                            >
                                              <X className="w-3 h-3" />
                                            </button>
                                          )}
                                        </div>
                                        <span className="text-xs text-muted-foreground">
                                          {filteredMessages.length} / {session.messages?.length || 0}
                                        </span>
                                      </div>

                                      <div className="max-h-[500px] overflow-y-auto">
                                        {filteredMessages.length === 0 && (
                                          <div className="py-6 text-center text-xs text-muted-foreground">
                                            {searchQuery ? "没有匹配的消息" : "没有消息"}
                                          </div>
                                        )}
                                        {filteredMessages.map((msg, j) => {
                                          const isUser = msg.role === "user";
                                          const isSystem = msg.role === "system";
                                          return (
                                            <div
                                              key={j}
                                              className={`px-4 py-3 border-b border-border/20 ${
                                                isUser
                                                  ? "bg-blue-500/5"
                                                  : isSystem
                                                    ? "bg-yellow-500/5"
                                                    : ""
                                              }`}
                                            >
                                              <div className="flex items-center gap-2 mb-1.5">
                                                <span
                                                  className={`text-xs font-medium ${
                                                    isUser
                                                      ? "text-blue-400"
                                                      : msg.role === "assistant"
                                                        ? "text-green-400"
                                                        : "text-yellow-400"
                                                  }`}
                                                >
                                                  {isUser ? "用户" : msg.role === "assistant" ? "智能体" : isSystem ? "系统" : msg.role}
                                                </span>
                                                {msg.model && (
                                                  <span className="text-xs px-1.5 py-0.5 bg-muted rounded text-muted-foreground">
                                                    {msg.model}
                                                  </span>
                                                )}
                                                {msg.timestamp && (
                                                  <span className="text-xs text-muted-foreground">
                                                    {new Date(msg.timestamp).toLocaleString("zh-CN")}
                                                  </span>
                                                )}
                                                <span className="text-xs text-muted-foreground ml-auto">
                                                  {msg.content?.length || 0} 字符
                                                </span>
                                              </div>
                                              <pre className="text-xs text-foreground whitespace-pre-wrap break-all font-sans leading-relaxed">
                                                {msg.content}
                                              </pre>
                                            </div>
                                          );
                                        })}
                                      </div>
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
            </div>
          )}
        </div>
      )}

      {scanMutation.isError && (
        <div className="flex items-center gap-2 text-sm text-red-400">
          <AlertCircle className="w-4 h-4" />
          扫描失败: {(scanMutation.error as Error)?.message || "未知错误"}
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
  adminOnly: true,
});

export default AgentLogAuditApp;
