import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agentApi, type AgentRuntimeEvent } from "../../api/analysis";
import {
  Bot, Search, RefreshCw, AlertTriangle, ShieldAlert, Info,
  ChevronDown, ChevronRight, Copy, Check, Loader2, Filter, X,
  ChevronLeft, Calendar,
} from "lucide-react";

const SEV_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  critical: { color: "text-red-400", bg: "bg-red-500/10", label: "严重" },
  high: { color: "text-orange-400", bg: "bg-orange-500/10", label: "高危" },
  medium: { color: "text-yellow-400", bg: "bg-yellow-500/10", label: "可疑" },
  info: { color: "text-muted-foreground", bg: "bg-secondary", label: "正常" },
};

const TYPE_OPTIONS = [
  { value: "", label: "全部类型" },
  { value: "user_input", label: "用户输入" },
  { value: "model_output", label: "模型输出" },
  { value: "system_prompt", label: "系统提示" },
  { value: "message", label: "消息" },
];

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
      className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground shrink-0" title="复制">
      {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
    </button>
  );
}

function Pagination({ page, totalPages, total, pageSize, onPageChange, onPageSizeChange }: {
  page: number; totalPages: number; total: number; pageSize: number;
  onPageChange: (p: number) => void; onPageSizeChange: (s: number) => void;
}) {
  if (total === 0) return null;

  const pages: (number | "...")[] = [];
  if (totalPages <= 7) {
    for (let i = 0; i < totalPages; i++) pages.push(i);
  } else {
    pages.push(0);
    if (page > 2) pages.push("...");
    const start = Math.max(1, page - 1);
    const end = Math.min(totalPages - 2, page + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (page < totalPages - 3) pages.push("...");
    pages.push(totalPages - 1);
  }

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-border flex-wrap gap-2">
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">共 {total} 条</span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">每页</span>
          <select value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="bg-secondary border border-border rounded px-1.5 py-0.5 text-xs text-foreground">
            {PAGE_SIZE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="text-xs text-muted-foreground">条</span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button onClick={() => onPageChange(0)} disabled={page === 0}
          className="px-2 py-1 text-xs bg-secondary border border-border rounded disabled:opacity-30 hover:bg-secondary/80">首页</button>
        <button onClick={() => onPageChange(page - 1)} disabled={page === 0}
          className="p-1 bg-secondary border border-border rounded disabled:opacity-30 hover:bg-secondary/80">
          <ChevronLeft size={12} />
        </button>
        {pages.map((p, i) =>
          p === "..." ? (
            <span key={`d${i}`} className="px-1 text-xs text-muted-foreground">...</span>
          ) : (
            <button key={p} onClick={() => onPageChange(p)}
              className={`min-w-[28px] px-1.5 py-1 text-xs rounded border ${p === page ? "bg-primary text-primary-foreground border-primary" : "bg-secondary border-border hover:bg-secondary/80"}`}>
              {p + 1}
            </button>
          )
        )}
        <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages - 1}
          className="p-1 bg-secondary border border-border rounded disabled:opacity-30 hover:bg-secondary/80">
          <ChevronLeft size={12} className="rotate-180" />
        </button>
        <button onClick={() => onPageChange(totalPages - 1)} disabled={page >= totalPages - 1}
          className="px-2 py-1 text-xs bg-secondary border border-border rounded disabled:opacity-30 hover:bg-secondary/80">末页</button>
      </div>
    </div>
  );
}

export default function AgentLogAudit() {
  const queryClient = useQueryClient();
  const [selectedAgent, setSelectedAgent] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sevFilter, setSevFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  const { data: agentsData } = useQuery({
    queryKey: ["agent-list"],
    queryFn: () => agentApi.listAgents(),
    staleTime: 30000,
  });

  const agents = (agentsData?.agents || []).filter((a: any) => a.detected);

  const { data: eventsData } = useQuery({
    queryKey: ["agent-log-events", selectedAgent, sevFilter, typeFilter, search, page, pageSize, startTime, endTime],
    queryFn: () => agentApi.runtimeEvents({
      agent: selectedAgent || undefined,
      severity: sevFilter || undefined,
      event_type: typeFilter || undefined,
      search: search || undefined,
      start_time: startTime || undefined,
      end_time: endTime || undefined,
      limit: pageSize,
      offset: page * pageSize,
    }),
    staleTime: 0,
    refetchInterval: 15000,
  });

  const parseMutation = useMutation({
    mutationFn: (params: { agent_name?: string; path?: string }) => agentApi.parseLogs(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-log-events"] });
      queryClient.invalidateQueries({ queryKey: ["agent-list"] });
    },
  });

  const events = eventsData?.events || [];
  const total = eventsData?.total || 0;
  const sevMap = eventsData?.sev_map || {};
  const agentMap = eventsData?.agent_map || {};
  const totalPages = Math.ceil(total / pageSize);

  const handleScan = () => {
    parseMutation.mutate({ agent_name: selectedAgent || undefined });
  };

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(0);
  };

  const clearFilters = () => {
    setSevFilter("");
    setTypeFilter("");
    setSearch("");
    setSearchInput("");
    setSelectedAgent("");
    setPage(0);
    setStartTime("");
    setEndTime("");
  };

  const hasFilters = sevFilter || typeFilter || search || selectedAgent || startTime || endTime;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center border border-cyan-500/20">
          <Bot size={20} className="text-cyan-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">智能体日志</h1>
          <p className="text-sm text-muted-foreground mt-1">智能体行为时间线与风险分析（数据持久化存储，支持增量扫描）</p>
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Filter size={14} />
          <span>扫描与筛选</span>
          {hasFilters && (
            <button onClick={clearFilters} className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <X size={12} />清除筛选
            </button>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select value={selectedAgent} onChange={(e) => { setSelectedAgent(e.target.value); setPage(0); }}
            className="bg-secondary border border-border rounded-md px-3 py-1.5 text-sm text-foreground min-w-[160px]">
            <option value="">全部智能体</option>
            {agents.map((a: any) => (
              <option key={a.name} value={a.name}>{a.name}</option>
            ))}
          </select>
          <select value={sevFilter} onChange={(e) => { setSevFilter(e.target.value); setPage(0); }}
            className="bg-secondary border border-border rounded-md px-3 py-1.5 text-sm text-foreground">
            <option value="">全部级别</option>
            <option value="critical">严重</option>
            <option value="high">高危</option>
            <option value="medium">可疑</option>
            <option value="info">正常</option>
          </select>
          <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
            className="bg-secondary border border-border rounded-md px-3 py-1.5 text-sm text-foreground">
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <div className="flex items-center gap-1.5">
            <Calendar size={14} className="text-muted-foreground shrink-0" />
            <input type="datetime-local" value={startTime} onChange={(e) => { setStartTime(e.target.value ? new Date(e.target.value).toISOString() : ""); setPage(0); }}
              className="bg-secondary border border-border rounded-md px-2 py-1.5 text-sm text-foreground" />
            <span className="text-xs text-muted-foreground">~</span>
            <input type="datetime-local" value={endTime ? new Date(endTime).toISOString().slice(0, 16) : ""} onChange={(e) => { setEndTime(e.target.value ? new Date(e.target.value).toISOString() : ""); setPage(0); }}
              className="bg-secondary border border-border rounded-md px-2 py-1.5 text-sm text-foreground" />
          </div>
          <div className="flex items-center gap-1 flex-1 min-w-[200px]">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input type="text" value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="搜索内容、规则、文件路径..."
                className="w-full bg-secondary border border-border rounded-md pl-8 pr-3 py-1.5 text-sm text-foreground" />
            </div>
            <button onClick={handleSearch} className="px-3 py-1.5 bg-primary/20 text-primary rounded-md text-sm hover:bg-primary/30">搜索</button>
          </div>
          <button onClick={handleScan} disabled={parseMutation.isPending}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 disabled:opacity-50">
            {parseMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {parseMutation.isPending ? "扫描中..." : "扫描增量"}
          </button>
        </div>
      </div>

      {parseMutation.isSuccess && (parseMutation.data as any)?.new_count !== undefined && (
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-4 py-2 text-sm text-emerald-400">
          扫描完成: 解析 {(parseMutation.data as any).total} 条事件，新增入库 {(parseMutation.data as any).new_count} 条
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-card rounded-lg border border-border p-4 flex items-start gap-3">
          <div className="p-2 rounded-lg bg-red-500/10 text-red-400"><ShieldAlert size={18} /></div>
          <div>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">严重 + 高危</p>
            <p className="text-xl font-bold">{(sevMap.critical || 0) + (sevMap.high || 0)}</p>
          </div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4 flex items-start gap-3">
          <div className="p-2 rounded-lg bg-yellow-500/10 text-yellow-400"><AlertTriangle size={18} /></div>
          <div>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">可疑</p>
            <p className="text-xl font-bold">{sevMap.medium || 0}</p>
          </div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4 flex items-start gap-3">
          <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400"><Info size={18} /></div>
          <div>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">正常</p>
            <p className="text-xl font-bold">{sevMap.info || 0}</p>
          </div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4 flex items-start gap-3">
          <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400"><Bot size={18} /></div>
          <div>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">当前筛选结果</p>
            <p className="text-xl font-bold">{total}</p>
          </div>
        </div>
      </div>

      {Object.keys(agentMap).length > 1 && (
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <Bot size={14} className="text-muted-foreground" />
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">各智能体日志数量</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(agentMap).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
              <button key={name} onClick={() => { setSelectedAgent(selectedAgent === name ? "" : name); setPage(0); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors ${selectedAgent === name ? "bg-primary/10 border-primary/30 text-primary" : "bg-secondary border-border text-foreground hover:border-primary/30"}`}>
                <span className="font-medium">{name}</span>
                <span className="text-muted-foreground">{count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="bg-card rounded-lg border border-border">
        {events.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <Bot className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>{total === 0 ? '暂无日志记录，点击"扫描增量"开始' : "当前筛选条件下无匹配结果"}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[130px_60px_90px_80px_minmax(100px,1fr)_40px] gap-1.5 px-4 py-2.5 text-[10px] text-muted-foreground font-medium border-b border-border items-center uppercase tracking-wider">
              <span>时间</span>
              <span>级别</span>
              <span>Agent</span>
              <span>类型</span>
              <span>内容</span>
              <span></span>
            </div>
            <div className="divide-y divide-border">
              {events.map((evt: AgentRuntimeEvent) => {
                const sev = SEV_CONFIG[evt.Severity] || SEV_CONFIG.info;
                const isExpanded = expandedId === evt.ID;
                const fmtTime = (ts: string) => {
                  if (!ts) return "-";
                  const d = new Date(ts);
                  const p = (n: number) => String(n).padStart(2, "0");
                  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
                };
                const typeLabels: Record<string, string> = {
                  user_input: "用户输入",
                  model_output: "模型输出",
                  system_prompt: "系统提示",
                  message: "消息",
                };
                return (
                  <div key={evt.ID}>
                    <div className={`grid grid-cols-[130px_60px_90px_80px_minmax(100px,1fr)_40px] gap-1.5 px-4 py-2.5 items-center hover:bg-secondary/30 cursor-pointer ${isExpanded ? "bg-secondary/30" : ""}`}
                      onClick={() => setExpandedId(isExpanded ? null : evt.ID)}>
                      <span className="text-[11px] text-muted-foreground font-mono">{fmtTime(evt.EventAt)}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${sev.bg} ${sev.color}`}>
                        {sev.label}
                      </span>
                      <span className="text-[11px] truncate">{evt.AgentName}</span>
                      <span className="text-[11px] text-muted-foreground">{typeLabels[evt.EventType] || evt.EventType}</span>
                      <span className="truncate text-[11px] font-mono" title={evt.Details || evt.EventTarget}>
                        {(evt.RuleName || evt.EventTarget || evt.Details || "").length > 100 ? (evt.RuleName || evt.EventTarget || evt.Details || "").slice(0, 100) + "..." : (evt.RuleName || evt.EventTarget || evt.Details || "")}
                      </span>
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
                              <span className="text-[10px] text-muted-foreground font-semibold">完整内容</span>
                              <CopyBtn text={evt.Details} />
                            </div>
                            <pre className="mt-1 bg-background border border-border rounded-md p-3 text-xs font-mono whitespace-pre-wrap break-all max-h-40 overflow-auto">{evt.Details}</pre>
                          </div>
                        )}
                        <div className="flex gap-4 text-[10px] text-muted-foreground">
                          {evt.LogSource && <span>来源: {evt.LogSource}</span>}
                          {evt.EventTarget && <span>目标: {evt.EventTarget}</span>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <Pagination page={page} totalPages={totalPages} total={total} pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(s) => { setPageSize(s); setPage(0); }} />
          </>
        )}
      </div>
    </div>
  );
}
