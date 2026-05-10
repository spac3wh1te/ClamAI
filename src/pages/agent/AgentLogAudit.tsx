import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agentApi, type AgentRuntimeEvent } from "../../api/analysis";
import {
  Bot, Search, RefreshCw, AlertTriangle, ShieldAlert, Info,
  ChevronDown, ChevronRight, Copy, Check, Loader2, Filter, X,
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
  const [searchInput, setSearchInput] = useState("");
  const [sevFilter, setSevFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const { data: agentsData } = useQuery({
    queryKey: ["agent-list"],
    queryFn: () => agentApi.listAgents(),
    staleTime: 30000,
  });

  const agents = (agentsData?.agents || []).filter((a: any) => a.detected);

  const { data: eventsData } = useQuery({
    queryKey: ["agent-log-events", selectedAgent, sevFilter, typeFilter, search, page],
    queryFn: () => agentApi.runtimeEvents({
      agent: selectedAgent || undefined,
      severity: sevFilter || undefined,
      event_type: typeFilter || undefined,
      search: search || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
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
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const critical = sevMap.critical || 0;
  const high = sevMap.high || 0;
  const medium = sevMap.medium || 0;
  const info = sevMap.info || 0;

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
  };

  const hasFilters = sevFilter || typeFilter || search || selectedAgent;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center border border-cyan-500/20">
          <Bot size={20} className="text-cyan-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">AI Agent 日志审计</h1>
          <p className="text-sm text-muted-foreground mt-1">智能体日志行为时间线与风险分析（数据持久化存储，支持增量扫描）</p>
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

      <div className="grid grid-cols-5 gap-3">
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
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">正常</p>
            <p className="text-xl font-bold">{info}</p>
          </div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4 flex items-start gap-3">
          <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400"><Bot size={18} /></div>
          <div>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">总记录</p>
            <p className="text-xl font-bold">{total}</p>
          </div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4 flex items-start gap-3">
          <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400"><Search size={18} /></div>
          <div>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">当前筛选</p>
            <p className="text-xl font-bold">{events.length}</p>
          </div>
        </div>
      </div>

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
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                <p className="text-sm text-muted-foreground">第 {page + 1} / {totalPages} 页 (共 {total} 条)</p>
                <div className="flex gap-2">
                  <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
                    className="px-3 py-1.5 text-sm bg-secondary border border-border rounded-md disabled:opacity-30">上一页</button>
                  <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
                    className="px-3 py-1.5 text-sm bg-secondary border border-border rounded-md disabled:opacity-30">下一页</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
