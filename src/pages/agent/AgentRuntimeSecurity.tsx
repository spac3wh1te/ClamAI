import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentApi, type AgentRuntimeEvent } from "../../api/analysis";
import {
  Terminal, ShieldAlert, AlertTriangle, Info, ChevronDown, ChevronRight, Copy, Check, Search,
} from "lucide-react";

const SEV_CONFIG: Record<string, { color: string; bg: string; border: string; label: string }> = {
  critical: { color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30", label: "严重" },
  high: { color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/30", label: "高危" },
  medium: { color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/30", label: "可疑" },
  low: { color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/30", label: "低危" },
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

export default function AgentRuntimeSecurity() {
  const [agent, setAgent] = useState("");
  const [severity, setSeverity] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const { data: agentsData } = useQuery({
    queryKey: ["agent-list"],
    queryFn: () => agentApi.listAgents(),
    staleTime: 30000,
  });

  const { data: eventsData } = useQuery({
    queryKey: ["agent-runtime-events", agent, severity, page],
    queryFn: () => agentApi.runtimeEvents({ agent: agent || undefined, severity: severity || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    staleTime: 0,
    refetchInterval: 30000,
  });

  const events = eventsData?.events || [];
  const total = eventsData?.total || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const sevCounts: Record<string, number> = {};
  for (const e of events) {
    sevCounts[e.Severity] = (sevCounts[e.Severity] || 0) + 1;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
          <Terminal size={20} className="text-orange-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">AI Agent 运行时安全</h1>
          <p className="text-sm text-muted-foreground mt-1">智能体工具调用行为分析与高危事件告警</p>
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <select value={agent} onChange={(e) => { setAgent(e.target.value); setPage(0); }}
            className="bg-secondary border border-border rounded-md px-3 py-1.5 text-sm text-foreground min-w-[160px]">
            <option value="">全部智能体</option>
            {(agentsData?.agents || []).filter((a: any) => a.detected).map((a: any) => (
              <option key={a.name} value={a.name}>{a.name}</option>
            ))}
          </select>
          <select value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(0); }}
            className="bg-secondary border border-border rounded-md px-3 py-1.5 text-sm text-foreground">
            <option value="">全部级别</option>
            <option value="critical">严重</option>
            <option value="high">高危</option>
            <option value="medium">可疑</option>
            <option value="low">低危</option>
          </select>
          <span className="text-sm text-muted-foreground ml-auto">共 {total} 条记录</span>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="bg-card rounded-lg border border-border p-8 text-center text-muted-foreground">
          <Terminal className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>暂无运行时安全事件</p>
          <p className="text-xs mt-1">通过日志审计页面扫描后，高危事件将自动记录于此</p>
        </div>
      ) : (
        <div className="bg-card rounded-lg border border-border">
          <div className="grid grid-cols-[130px_60px_100px_100px_minmax(100px,1fr)_40px] gap-1.5 px-4 py-2.5 text-[10px] text-muted-foreground font-medium border-b border-border items-center uppercase tracking-wider">
            <span>时间</span>
            <span>级别</span>
            <span>Agent</span>
            <span>行为类型</span>
            <span>目标/规则</span>
            <span></span>
          </div>
          <div className="divide-y divide-border">
            {events.map((evt: AgentRuntimeEvent) => {
              const sev = SEV_CONFIG[evt.Severity] || SEV_CONFIG.low;
              const isExpanded = expandedId === evt.ID;
              const fmtTime = (ts: string) => {
                if (!ts) return "-";
                const d = new Date(ts);
                const p = (n: number) => String(n).padStart(2, "0");
                return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
              };
              return (
                <div key={evt.ID}>
                  <div className={`grid grid-cols-[130px_60px_100px_100px_minmax(100px,1fr)_40px] gap-1.5 px-4 py-2.5 items-center text-sm cursor-pointer hover:bg-secondary/30 ${isExpanded ? "bg-secondary/30" : ""}`}
                    onClick={() => setExpandedId(isExpanded ? null : evt.ID)}>
                    <span className="text-[11px] text-muted-foreground font-mono">{fmtTime(evt.EventAt)}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${sev.bg} ${sev.color} border ${sev.border}`}>{sev.label}</span>
                    <span className="text-[11px] truncate">{evt.AgentName}</span>
                    <span className="text-[11px] text-muted-foreground">{evt.EventType}</span>
                    <span className="text-[11px] truncate" title={evt.EventTarget}>{evt.EventTarget}</span>
                    <span className="text-muted-foreground">
                      {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </span>
                  </div>
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1 space-y-2">
                      {evt.RuleName && (
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground font-semibold">命中规则:</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${sev.bg} ${sev.color}`}>{evt.RuleName}</span>
                        </div>
                      )}
                      {evt.Details && (
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground font-semibold">事件详情</span>
                            <CopyBtn text={evt.Details} />
                          </div>
                          <pre className="mt-1 bg-background border border-border rounded-md p-3 text-xs font-mono whitespace-pre-wrap break-all max-h-40 overflow-auto">{evt.Details}</pre>
                        </div>
                      )}
                      <div className="flex gap-4 text-[10px] text-muted-foreground">
                        <span>来源: {evt.LogSource || "-"}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <p className="text-sm text-muted-foreground">第 {page + 1} / {totalPages} 页</p>
              <div className="flex gap-2">
                <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
                  className="px-3 py-1.5 text-sm bg-secondary border border-border rounded-md disabled:opacity-30">上一页</button>
                <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
                  className="px-3 py-1.5 text-sm bg-secondary border border-border rounded-md disabled:opacity-30">下一页</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
