import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { agentApi, type AgentInfo } from "../../api/analysis";
import {
  Bot, ShieldCheck, ShieldAlert, ShieldX, Loader2, RefreshCw, ChevronDown, ChevronRight,
} from "lucide-react";

export default function AgentEnvironment() {
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const { data: agentsData, isLoading, refetch } = useQuery({
    queryKey: ["agent-list"],
    queryFn: () => agentApi.listAgents(),
    staleTime: 30000,
  });

  const deepCheckMutation = useMutation({
    mutationFn: (params: { agentName: string; model?: string }) => agentApi.deepCheck(params.agentName, params.model),
  });

  const agents = (agentsData?.agents || []).filter((a: AgentInfo) => a.detected);

  const tagConfig = [
    { key: "has_config" as const, label: "配置", color: "bg-blue-500/10 text-blue-400" },
    { key: "has_skills" as const, label: "Skills", color: "bg-purple-500/10 text-purple-400" },
    { key: "has_logs" as const, label: "日志", color: "bg-emerald-500/10 text-emerald-400" },
  ];

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
              const checkResult = deepCheckMutation.data as any;
              const isChecking = deepCheckMutation.isPending && (deepCheckMutation.variables as any)?.agentName === agent.name;
              const hasResult = isExpanded && checkResult && checkResult.agent === agent.name;

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
                      <div className="text-xs text-muted-foreground">
                        <span>目录: </span>
                        <code className="font-mono">{agent.dir}</code>
                      </div>
                      {hasResult && checkResult.checks && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">综合评分:</span>
                            <span className={`text-lg font-bold ${
                              checkResult.score >= 80 ? "text-green-400" : checkResult.score >= 60 ? "text-yellow-400" : "text-red-400"
                            }`}>{checkResult.score}/100</span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {(checkResult.checks as any[]).map((check: any, i: number) => (
                              <div key={i} className={`text-[11px] px-2 py-1.5 rounded flex items-start gap-2 ${
                                check.status === "pass" ? "bg-green-500/5 text-green-400" :
                                check.status === "fail" ? "bg-red-500/5 text-red-400" :
                                check.status === "warn" ? "bg-yellow-500/5 text-yellow-400" :
                                "bg-secondary text-muted-foreground"
                              }`}>
                                <span className="shrink-0 mt-0.5">
                                  {check.status === "pass" ? "✓" : check.status === "fail" ? "✗" : check.status === "warn" ? "⚠" : "ℹ"}
                                </span>
                                <div>
                                  <span className="font-medium">{check.name}</span>
                                  {check.detail && <p className="text-muted-foreground mt-0.5">{check.detail}</p>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {isChecking && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 size={14} className="animate-spin" /> 正在执行安全检测...
                        </div>
                      )}
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
