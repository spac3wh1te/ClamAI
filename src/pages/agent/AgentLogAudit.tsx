import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agentApi, type AgentInfo, type TimelineEvent, type TimelineParseResult } from "../../api/analysis";
import {
  Bot, Search, RefreshCw, AlertTriangle, ShieldAlert, Info,
  ChevronDown, ChevronRight, Copy, Check, Loader2,
} from "lucide-react";

const SEV_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  critical: { color: "text-red-400", bg: "bg-red-500/10", label: "严重" },
  high: { color: "text-orange-400", bg: "bg-orange-500/10", label: "高危" },
  medium: { color: "text-yellow-400", bg: "bg-yellow-500/10", label: "可疑" },
  info: { color: "text-muted-foreground", bg: "bg-secondary", label: "正常" },
};

const TYPE_LABELS: Record<string, string> = {
  user_input: "用户输入",
  model_output: "模型输出",
  system_prompt: "系统提示",
  message: "消息",
};

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
      className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground shrink-0" title="复制">
      {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
    </button>
  );
}

export default function AgentLogAudit() {
  const queryClient = useQueryClient();
  const [selectedAgent, setSelectedAgent] = useState("");
  const [search, setSearch] = useState("");
  const [sevFilter, setSevFilter] = useState("");
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const { data: agentsData } = useQuery({
    queryKey: ["agent-list"],
    queryFn: () => agentApi.listAgents(),
    staleTime: 30000,
  });

  const agents = (agentsData?.agents || []).filter((a: AgentInfo) => a.detected);

  const parseMutation = useMutation({
    mutationFn: (params: { agent_name?: string; path?: string }) => agentApi.parseLogs(params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agent-log-events"] }),
  });

  const result = parseMutation.data as TimelineParseResult | undefined;
  const events = result?.events || [];

  const filtered = events.filter((e: TimelineEvent) => {
    if (sevFilter && e.severity !== sevFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return e.content.toLowerCase().includes(q) || e.agent_name.toLowerCase().includes(q) || (e.rule_name || "").toLowerCase().includes(q);
    }
    return true;
  });

  const critical = events.filter((e: TimelineEvent) => e.severity === "critical").length;
  const high = events.filter((e: TimelineEvent) => e.severity === "high").length;
  const medium = events.filter((e: TimelineEvent) => e.severity === "medium").length;

  const handleScan = () => {
    parseMutation.mutate({ agent_name: selectedAgent || undefined });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center border border-cyan-500/20">
          <Bot size={20} className="text-cyan-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">AI Agent 日志审计</h1>
          <p className="text-sm text-muted-foreground mt-1">智能体日志行为时间线与风险分析</p>
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <select value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)}
            className="bg-secondary border border-border rounded-md px-3 py-1.5 text-sm text-foreground min-w-[160px]">
            <option value="">全部智能体</option>
            {agents.map((a: AgentInfo) => (
              <option key={a.name} value={a.name}>{a.name} ({a.session_count})</option>
            ))}
          </select>
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索关键词..."
              className="w-full bg-secondary border border-border rounded-md pl-8 pr-3 py-1.5 text-sm text-foreground" />
          </div>
          <select value={sevFilter} onChange={(e) => setSevFilter(e.target.value)}
            className="bg-secondary border border-border rounded-md px-3 py-1.5 text-sm text-foreground">
            <option value="">全部级别</option>
            <option value="critical">严重</option>
            <option value="high">高危</option>
            <option value="medium">可疑</option>
            <option value="info">正常</option>
          </select>
          <button onClick={handleScan} disabled={parseMutation.isPending}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 disabled:opacity-50">
            {parseMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {parseMutation.isPending ? "扫描中..." : "开始扫描"}
          </button>
        </div>
      </div>

      {result && (
        <>
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-card rounded-lg border border-border p-4 flex items-start gap-3">
              <div className="p-2 rounded-lg bg-red-500/10 text-red-400"><ShieldAlert size={18} /></div>
              <div>
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">严重 + 高危</p>
                <p className="text-xl font-bold">{critical + high}</p>
              </div>
            </div>
            <div className="bg-card rounded-lg border border-border p-4 flex items-start gap-3">
              <div className="p-2 rounded-lg bg-yellow-500/10 text-yellow-400"><AlertTriangle size={18} /></div>
              <div>
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">可疑</p>
                <p className="text-xl font-bold">{medium}</p>
              </div>
            </div>
            <div className="bg-card rounded-lg border border-border p-4 flex items-start gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400"><Info size={18} /></div>
              <div>
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">总事件</p>
                <p className="text-xl font-bold">{events.length}</p>
              </div>
            </div>
            <div className="bg-card rounded-lg border border-border p-4 flex items-start gap-3">
              <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400"><Bot size={18} /></div>
              <div>
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">涉及智能体</p>
                <p className="text-xl font-bold">{new Set(events.map((e: TimelineEvent) => e.agent_name)).size}</p>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-lg border border-border">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <Bot className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>暂无日志事件，点击"开始扫描"</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {filtered.map((evt: TimelineEvent, i: number) => {
                  const sev = SEV_CONFIG[evt.severity] || SEV_CONFIG.info;
                  const isExpanded = expandedIdx === i;
                  return (
                    <div key={i}>
                      <div className={`flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/30 cursor-pointer ${isExpanded ? "bg-secondary/30" : ""}`}
                        onClick={() => setExpandedIdx(isExpanded ? null : i)}>
                        <span className="text-muted-foreground shrink-0">
                          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </span>
                        <span className="text-[11px] text-muted-foreground font-mono shrink-0 min-w-[130px]">
                          {evt.timestamp ? new Date(evt.timestamp).toLocaleString("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }) : "-"}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${sev.bg} ${sev.color}`}>
                          {sev.label}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-secondary text-muted-foreground shrink-0">
                          {evt.agent_name}
                        </span>
                        <span className="text-[11px] text-muted-foreground shrink-0">
                          {TYPE_LABELS[evt.event_type] || evt.event_type}
                        </span>
                        <span className="truncate flex-1 text-[11px] font-mono" title={evt.content}>
                          {evt.content.length > 100 ? evt.content.slice(0, 100) + "..." : evt.content}
                        </span>
                        <CopyBtn text={evt.content} />
                      </div>
                      {isExpanded && (
                        <div className="px-4 pb-4 pt-1 space-y-2">
                          {evt.rule_name && (
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-muted-foreground font-semibold">命中规则:</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${sev.bg} ${sev.color}`}>{evt.rule_name}</span>
                            </div>
                          )}
                          <div>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-muted-foreground font-semibold">完整内容</span>
                              <CopyBtn text={evt.content} />
                            </div>
                            <pre className="mt-1 bg-background border border-border rounded-md p-3 text-xs font-mono whitespace-pre-wrap break-all max-h-40 overflow-auto">
                              {evt.content || "(空)"}
                            </pre>
                          </div>
                          <div className="flex gap-4 text-[10px] text-muted-foreground">
                            <span>来源: {evt.file_path}</span>
                            <span>类型: {evt.event_type}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
