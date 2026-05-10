import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { agentApi, type AgentInfo } from "../../api/analysis";
import {
  Bot, Loader2, RefreshCw, ChevronDown, ChevronRight,
  ShieldCheck, ShieldAlert, AlertTriangle, Info, Folder, FileText,
} from "lucide-react";

interface CheckItem {
  category: string;
  name: string;
  status: string;
  detail: string;
  items?: string[];
}

const CATEGORY_LABELS: Record<string, string> = {
  security: "安全",
  files: "文件",
  system: "系统",
  network: "网络",
  services: "服务",
};

const RECOMMENDATIONS: Record<string, string> = {
  "敏感命名文件": "检查这些文件是否包含真实的敏感数据，考虑移除或重命名。若为智能体配置所需，确保文件权限为仅属主可读。",
  "凭据泄露风险": "将硬编码凭据迁移到环境变量或密钥管理服务。确保 .gitignore 包含相关文件。必要时轮换已暴露的密钥。",
  "目录权限": "运行 chmod 700 <目录> 收紧权限，防止其他用户读取智能体配置和会话数据。",
  "存储使用": "定期清理旧会话日志，避免磁盘空间耗尽。",
  "会话记录": "会话记录可能包含敏感对话内容，定期审查和清理。建议设置日志轮转策略。",
  "Skills/规则文件": "审查 Skills 文件内容，确保不包含恶意指令或提示注入。可使用 Skills 检测工具进行 AI 辅助分析。",
};

const STATUS_CONFIG: Record<string, { icon: typeof ShieldCheck; color: string; bg: string; label: string }> = {
  pass: { icon: ShieldCheck, color: "text-green-400", bg: "bg-green-500/5", label: "通过" },
  fail: { icon: ShieldAlert, color: "text-red-400", bg: "bg-red-500/5", label: "风险" },
  warn: { icon: AlertTriangle, color: "text-yellow-400", bg: "bg-yellow-500/5", label: "警告" },
  info: { icon: Info, color: "text-blue-400", bg: "bg-blue-500/5", label: "信息" },
};

export default function AgentEnvironment() {
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { checks: CheckItem[]; score: number; agent: string; dir: string }>>({});
  const [expandedCheck, setExpandedCheck] = useState<string | null>(null);

  const { data: agentsData, isLoading, refetch } = useQuery({
    queryKey: ["agent-list"],
    queryFn: () => agentApi.listAgents(),
    staleTime: 30000,
  });

  const deepCheckMutation = useMutation({
    mutationFn: (params: { agentName: string; model?: string }) => agentApi.deepCheck(params.agentName, params.model),
    onSuccess: (data: any) => {
      if (data?.agent) {
        setResults((prev) => ({ ...prev, [data.agent]: data }));
      }
    },
  });

  const agents = (agentsData?.agents || []).filter((a: AgentInfo) => a.detected);

  const tagConfig = [
    { key: "has_config" as const, label: "配置", color: "bg-blue-500/10 text-blue-400" },
    { key: "has_skills" as const, label: "Skills", color: "bg-purple-500/10 text-purple-400" },
    { key: "has_logs" as const, label: "日志", color: "bg-emerald-500/10 text-emerald-400" },
  ];

  const groupedChecks = (checks: CheckItem[]) => {
    const groups: Record<string, CheckItem[]> = {};
    for (const c of checks) {
      const cat = CATEGORY_LABELS[c.category] || c.category;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(c);
    }
    return groups;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
            <Bot size={20} className="text-purple-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">AI Agent 环境安全</h1>
            <p className="text-sm text-muted-foreground mt-1">智能体目录发现、环境检测与配置安全扫描</p>
          </div>
        </div>
        <button onClick={() => refetch()} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-transparent">
          <RefreshCw size={14} /> 刷新
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
      ) : agents.length === 0 ? (
        <div className="bg-card rounded-lg border border-border p-8 text-center text-muted-foreground">
          <Bot className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>未检测到已安装的 AI 智能体</p>
        </div>
      ) : (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <div className="grid grid-cols-[minmax(120px,1fr)_60px_60px_60px_60px_80px] gap-2 px-4 py-2.5 text-[10px] text-muted-foreground font-medium border-b border-border items-center uppercase tracking-wider">
            <span>Agent</span>
            <span>配置</span>
            <span>Skills</span>
            <span>日志</span>
            <span>文件数</span>
            <span></span>
          </div>
          <div className="divide-y divide-border">
            {agents.map((agent: AgentInfo) => {
              const isExpanded = expandedAgent === agent.name;
              const isChecking = deepCheckMutation.isPending && (deepCheckMutation.variables as any)?.agentName === agent.name;
              const checkResult = results[agent.name];
              const hasResult = isExpanded && !!checkResult;

              return (
                <div key={agent.name}>
                  <div className={`grid grid-cols-[minmax(120px,1fr)_60px_60px_60px_60px_80px] gap-2 px-4 py-3 items-center hover:bg-secondary/30 cursor-pointer ${isExpanded ? "bg-secondary/30" : ""}`}
                    onClick={() => setExpandedAgent(isExpanded ? null : agent.name)}>
                    <div className="flex items-center gap-2">
                      <Bot size={14} className="text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium truncate">{agent.name}</span>
                    </div>
                    {tagConfig.map((tc) => (
                      <span key={tc.key} className={`text-[10px] px-1.5 py-0.5 rounded ${agent[tc.key] ? tc.color : "bg-muted text-muted-foreground/50"}`}>
                        {agent[tc.key] ? "✓" : "✗"}
                      </span>
                    ))}
                    <span className="text-[11px] text-muted-foreground">{agent.session_count}</span>
                    <button onClick={(e) => {
                      e.stopPropagation();
                      deepCheckMutation.mutate({ agentName: agent.name });
                      setExpandedAgent(agent.name);
                    }} disabled={isChecking}
                      className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 disabled:opacity-50">
                      {isChecking ? "检测中..." : "安全检测"}
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1 space-y-3 border-t border-border/50">
                      <div className="flex items-center gap-3">
                        <code className="text-xs text-muted-foreground font-mono">{agent.dir}</code>
                        {hasResult && (
                          <div className="flex items-center gap-2 ml-auto">
                            <span className="text-xs text-muted-foreground">评分:</span>
                            <span className={`text-lg font-bold ${
                              checkResult.score >= 80 ? "text-green-400" : checkResult.score >= 60 ? "text-yellow-400" : "text-red-400"
                            }`}>{checkResult.score}<span className="text-xs text-muted-foreground font-normal">/100</span></span>
                          </div>
                        )}
                      </div>

                      {isChecking && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                          <Loader2 size={14} className="animate-spin" /> 正在执行安全检测...
                        </div>
                      )}

                      {hasResult && checkResult.checks && Object.entries(groupedChecks(checkResult.checks)).map(([cat, checks]) => (
                          <div key={cat}>
                            <h4 className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-2">{cat}</h4>
                            <div className="space-y-1.5">
                              {checks.map((check: CheckItem) => {
                                const cfg = STATUS_CONFIG[check.status] || STATUS_CONFIG.info;
                                const StatusIcon = cfg.icon;
                                const isCheckExpanded = expandedCheck === `${agent.name}:${check.name}`;
                                const hasItems = check.items && check.items.length > 0;
                                const needsDetail = check.status === "fail" || check.status === "warn" || hasItems;

                                return (
                                  <div key={check.name} className={`rounded-lg ${cfg.bg} border border-transparent`}>
                                    <div className={`flex items-center gap-2 px-3 py-2 ${needsDetail ? "cursor-pointer hover:bg-secondary/30" : ""}`}
                                      onClick={() => needsDetail && setExpandedCheck(isCheckExpanded ? null : `${agent.name}:${check.name}`)}>
                                      <StatusIcon size={14} className={cfg.color + " shrink-0"} />
                                      <span className={`text-[11px] font-medium ${cfg.color}`}>{check.name}</span>
                                      <span className="text-[11px] text-muted-foreground flex-1 truncate">{check.detail}</span>
                                      {needsDetail && (
                                        <span className="text-muted-foreground shrink-0">
                                          {isCheckExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                        </span>
                                      )}
                                    </div>
                                    {isCheckExpanded && needsDetail && (
                                      <div className="px-3 pb-3 pt-0 space-y-2 border-t border-border/30">
                                        {hasItems && (
                                          <div>
                                            <span className="text-[10px] text-muted-foreground font-semibold">相关文件:</span>
                                            <div className="mt-1 space-y-0.5">
                                              {check.items!.slice(0, 20).map((item: string, idx: number) => (
                                                <div key={idx} className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
                                                  {check.status === "fail" ? <ShieldAlert size={10} className="text-red-400 shrink-0" /> :
                                                   check.status === "warn" ? <AlertTriangle size={10} className="text-yellow-400 shrink-0" /> :
                                                   <FileText size={10} className="text-blue-400 shrink-0" />}
                                                  {item}
                                                </div>
                                              ))}
                                              {check.items!.length > 20 && (
                                                <span className="text-[10px] text-muted-foreground">...还有 {check.items!.length - 20} 个文件</span>
                                              )}
                                            </div>
                                          </div>
                                        )}
                                        {RECOMMENDATIONS[check.name] && (check.status === "fail" || check.status === "warn") && (
                                          <div className="bg-background/50 rounded-md p-2">
                                            <span className="text-[10px] text-muted-foreground font-semibold">处置建议:</span>
                                            <p className="text-[11px] text-foreground mt-0.5">{RECOMMENDATIONS[check.name]}</p>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
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
