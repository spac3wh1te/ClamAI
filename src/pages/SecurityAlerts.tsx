import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { securityApi, type SecurityAlert } from "../api/security";
import {
  ShieldAlert,
  ShieldCheck,
  Shield,
  CheckCircle,
  Bell,
  Search,
  Filter,
  X,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Activity,
  Zap,
  Clock,
} from "lucide-react";

const SEVERITY_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  critical: { label: "严重", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30" },
  high: { label: "高危", color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/30" },
  medium: { label: "中危", color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/30" },
  low: { label: "低危", color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/30" },
};

const TRIGGER_TYPE_OPTIONS = [
  { value: "", label: "全部类型" },
  { value: "keyword", label: "关键词" },
  { value: "semantic", label: "语义检测" },
  { value: "vector", label: "向量检测" },
];

const TRIGGER_TYPE_CONTENT = ["keyword", "semantic", "vector"];

const DIRECTION_OPTIONS = [
  { value: "", label: "全部方向" },
  { value: "input", label: "输入" },
  { value: "output", label: "输出" },
];

const SEVERITY_OPTIONS = [
  { value: "", label: "全部级别" },
  { value: "critical", label: "严重" },
  { value: "high", label: "高危" },
  { value: "medium", label: "中危" },
  { value: "low", label: "低危" },
];

const PAGE_SIZE = 20;

const SOURCE_OPTIONS = [
  { value: "content", label: "内容安全" },
  { value: "system_analysis", label: "威胁分析" },
];

function StatCard({ icon: Icon, label, value, sub, color }: { icon: React.ElementType; label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className="bg-card rounded-lg border border-border p-4 flex items-start gap-3">
      <div className={`p-2 rounded-lg ${color}`}>
        <Icon size={18} />
      </div>
      <div>
        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{label}</p>
        <p className="text-xl font-bold mt-0.5">{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); handleCopy(); }}
      className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground shrink-0"
      title="复制完整内容"
    >
      {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
    </button>
  );
}

function highlightMatch(text: string, keyword: string): React.ReactNode {
  if (!keyword || !text) return text || "-";
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx === -1) return text.length > 60 ? text.slice(0, 60) + "..." : text;
  const before = text.slice(Math.max(0, idx - 15), idx);
  const match = text.slice(idx, idx + keyword.length);
  const after = text.slice(idx + keyword.length, idx + keyword.length + 30);
  return (
    <span>
      {idx > 15 && "..."}{before}
      <mark className="bg-orange-500/20 text-orange-300 px-0.5 rounded">{match}</mark>
      {after}{idx + keyword.length + 30 < text.length && "..."}
    </span>
  );
}

export default function SecurityAlerts({ hideHeader, defaultSource = "content" }: { hideHeader?: boolean; defaultSource?: "content" | "system_analysis" }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [severity, setSeverity] = useState("");
  const [direction, setDirection] = useState("");
  const [triggerType, setTriggerType] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [source, setSource] = useState<"content" | "system_analysis">(defaultSource);

  const effectiveTriggerType = source === "content" ? triggerType : "system_analysis";

  const { data: statsData } = useQuery({
    queryKey: ["security-stats", source],
    queryFn: () => securityApi.getStats(source) as unknown as Promise<{ total: number; unresolved: number; today: number; hour24: number }>,
    staleTime: 5000,
    refetchInterval: 10000,
  });

  const { data: alertsData } = useQuery({
    queryKey: ["security-alerts", page, severity, direction, effectiveTriggerType, search, source],
    queryFn: () =>
      securityApi.getLogs({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        severity: severity || undefined,
        direction: direction || undefined,
        trigger_type: effectiveTriggerType || undefined,
        exclude_trigger_type: source === "content" && !triggerType ? "system_analysis" : undefined,
        search: search || undefined,
      }) as unknown as Promise<{ alerts: SecurityAlert[]; total: number }>,
    staleTime: 0,
    refetchInterval: 10000,
  });

  const rawAlerts = (alertsData?.alerts || []) as SecurityAlert[];
  const alerts = source === "content" ? rawAlerts.filter(a => a.trigger_type !== "system_analysis") : rawAlerts;
  const total = alertsData?.total || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const unresolvedCount = alerts.filter((a) => a.resolved === 0).length;

  const handleSearch = () => {
    setPage(0);
    setSearch(searchInput);
  };

  const clearFilters = () => {
    setSeverity("");
    setDirection("");
    setTriggerType("");
    setSearch("");
    setSearchInput("");
    setPage(0);
  };

  const hasFilters = severity || direction || triggerType || search;

  const getSeverityBadge = (sev: string) => {
    const cfg = SEVERITY_CONFIG[sev] || SEVERITY_CONFIG.high;
    return (
      <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${cfg.bg} ${cfg.color} border ${cfg.border}`}>
        {cfg.label}
      </span>
    );
  };

  const getTriggerLabel = (t: string) => {
    if (t?.startsWith("keyword")) return "关键词";
    if (t === "vector") return "向量检测";
    if (t === "semantic") return "语义检测";
    if (t === "buffer_overflow") return "缓冲溢出";
    return t;
  };

  const getDirectionBadge = (d: string) =>
    d === "input" ? (
      <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-blue-500/10 text-blue-400">输入</span>
    ) : (
      <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-purple-500/10 text-purple-400">输出</span>
    );

  const getModeBadge = (m: string) =>
    m === "block" ? (
      <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-500/10 text-amber-400">拦截</span>
    ) : (
      <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-cyan-500/10 text-cyan-400">检测</span>
    );

  return (
    <div className="space-y-4">
      {!hideHeader && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">{source === "content" ? "实时防护" : "威胁分析"}</h1>
              <p className="text-muted-foreground mt-2">
                {source === "content" ? "内容安全实时拦截与检测告警记录" : "AI威胁分析告警记录"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {unresolvedCount > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                  <Bell size={16} />
                  <span>{unresolvedCount} 条未处理</span>
                </div>
              )}
              <div className="text-sm text-muted-foreground">
                共 {total} 条记录
              </div>
            </div>
          </div>
          <div className="flex gap-1 bg-secondary/30 rounded-lg p-1 w-fit">
            {SOURCE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => { setSource(opt.value as "content" | "system_analysis"); setPage(0); }}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  source === opt.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-3">
            <StatCard icon={ShieldAlert} label="总告警数" value={total} color="bg-blue-500/10 text-blue-400" />
            <StatCard icon={Bell} label="未处理" value={unresolvedCount} color="bg-red-500/10 text-red-400" />
            <StatCard icon={Zap} label="今日新增" value={statsData?.today ?? "-"} color="bg-amber-500/10 text-amber-400" />
            <StatCard icon={Clock} label="近24小时" value={statsData?.hour24 ?? "-"} color="bg-purple-500/10 text-purple-400" />
          </div>
        </>
      )}

      <div className="bg-card rounded-lg border border-border p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Filter size={14} />
          <span>筛选条件</span>
          {hasFilters && (
            <button onClick={clearFilters} className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <X size={12} />
              清除筛选
            </button>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {source === "content" && (
            <>
              <select
                value={severity}
                onChange={(e) => { setSeverity(e.target.value); setPage(0); }}
                className="bg-secondary border border-border rounded-md px-3 py-1.5 text-sm text-foreground"
              >
                {SEVERITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <select
                value={direction}
                onChange={(e) => { setDirection(e.target.value); setPage(0); }}
                className="bg-secondary border border-border rounded-md px-3 py-1.5 text-sm text-foreground"
              >
                {DIRECTION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <select
                value={triggerType}
                onChange={(e) => { setTriggerType(e.target.value); setPage(0); }}
                className="bg-secondary border border-border rounded-md px-3 py-1.5 text-sm text-foreground"
              >
                {TRIGGER_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </>
          )}
          {source === "system_analysis" && (
            <select
              value={severity}
              onChange={(e) => { setSeverity(e.target.value); setPage(0); }}
              className="bg-secondary border border-border rounded-md px-3 py-1.5 text-sm text-foreground"
            >
              {SEVERITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-1 flex-1 min-w-[200px]">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="搜索关键词、内容、模型..."
                className="w-full bg-secondary border border-border rounded-md pl-8 pr-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <button
              onClick={handleSearch}
              className="px-3 py-1.5 bg-primary/20 text-primary rounded-md text-sm hover:bg-primary/30"
            >
              搜索
            </button>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border">
        {alerts.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <ShieldCheck className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>暂无安全告警记录</p>
          </div>
        ) : (
          <div>
            <div className="grid grid-cols-[35px_120px_50px_50px_55px_70px_1fr_55px] gap-1.5 px-4 py-2.5 text-[10px] text-muted-foreground font-medium border-b border-border items-center uppercase tracking-wider">
              <span>ID</span>
              <span>时间</span>
              <span>方向</span>
              <span>模式</span>
              <span>级别</span>
              <span>规则</span>
              <span>内容</span>
              <span>操作</span>
            </div>
            <div className="divide-y divide-border">
              {alerts.map((alert) => {
                const isExpanded = expandedId === alert.id;
                const ruleMatch = alert.trigger_detail?.match(/^\[([^\]]+)\]\s*(.+)$/);
                const ruleLabel = ruleMatch ? ruleMatch[1] : "";
                const ruleValue = ruleMatch ? ruleMatch[2] : alert.trigger_detail || "";

                return (
                  <div key={alert.id} className={alert.resolved ? "opacity-50" : ""}>
                    <div
                      className={`grid grid-cols-[35px_120px_50px_50px_55px_70px_1fr_55px] gap-1.5 px-4 py-2.5 items-center text-sm cursor-pointer hover:bg-secondary/30 ${isExpanded ? "bg-secondary/30" : ""}`}
                      onClick={() => setExpandedId(isExpanded ? null : alert.id)}
                    >
                      <span className="text-[11px] text-muted-foreground">{alert.id}</span>
                      <span className="text-[11px] text-muted-foreground" title={alert.timestamp ? new Date(alert.timestamp).toLocaleString("zh-CN") : ""}>
                        {alert.timestamp ? new Date(alert.timestamp).toLocaleString("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }) : "-"}
                      </span>
                      <span>{getDirectionBadge(alert.direction)}</span>
                      <span>{getModeBadge(alert.mode)}</span>
                      <span>{getSeverityBadge(alert.severity || "high")}</span>
                      <span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${
                          alert.trigger_type?.startsWith("keyword") ? "bg-orange-500/10 text-orange-400" :
                          alert.trigger_type === "vector" ? "bg-teal-500/10 text-teal-400" :
                          "bg-red-500/10 text-red-400"
                        }`}>
                          {getTriggerLabel(alert.trigger_type)}
                        </span>
                      </span>
                      <div className="min-w-0 text-[11px] text-muted-foreground flex items-center gap-1">
                        <span className="truncate flex-1">
                          {alert.content_preview ? highlightMatch(alert.content_preview, ruleValue) : "-"}
                        </span>
                        <CopyBtn text={alert.content_preview || ""} />
                        {isExpanded ? <ChevronDown size={12} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={12} className="shrink-0 text-muted-foreground" />}
                      </div>
                      <div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            securityApi.toggleAlert(alert.id).then(() =>
                              queryClient.invalidateQueries({ queryKey: ["security-alerts"] }),
                            );
                          }}
                          className={`px-2 py-0.5 text-[10px] rounded border ${
                            alert.resolved
                              ? "bg-secondary text-muted-foreground border-border hover:text-foreground"
                              : "bg-green-500/10 text-green-400 border-green-500/30 hover:bg-green-500/20"
                          }`}
                        >
                          {alert.resolved ? (
                            <span className="flex items-center gap-1"><CheckCircle size={10} /> 撤销</span>
                          ) : (
                            "处理"
                          )}
                        </button>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="px-4 pb-4 space-y-2">
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <span className="text-[10px] text-muted-foreground font-semibold">模型</span>
                            <p className="font-mono mt-0.5">{alert.model || "-"}</p>
                          </div>
                          <div>
                            <span className="text-[10px] text-muted-foreground font-semibold">API Key</span>
                            <p className="font-mono mt-0.5">{alert.api_key_used || "-"}</p>
                          </div>
                          <div>
                            <span className="text-[10px] text-muted-foreground font-semibold">来源 IP</span>
                            <p className="mt-0.5">{alert.client_ip || "-"}</p>
                          </div>
                          <div>
                            <span className="text-[10px] text-muted-foreground font-semibold">动作</span>
                            <p className="mt-0.5">{alert.action || "-"}</p>
                          </div>
                        </div>
                        {alert.trigger_detail && (
                          <div>
                            <span className="text-[10px] text-muted-foreground font-semibold">命中规则</span>
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${
                                alert.trigger_type?.startsWith("keyword") ? "bg-orange-500/10 text-orange-400" :
                                alert.trigger_type === "vector" ? "bg-teal-500/10 text-teal-400" :
                                "bg-red-500/10 text-red-400"
                              }`}>
                                {getTriggerLabel(alert.trigger_type)}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {ruleLabel && <span className="text-muted-foreground/60">{ruleLabel} </span>}
                                <code className="text-foreground">{ruleValue}</code>
                              </span>
                            </div>
                          </div>
                        )}
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground font-semibold">完整内容</span>
                            <CopyBtn text={alert.content_preview || ""} />
                          </div>
                          <pre className="mt-1 bg-background border border-border rounded-md p-3 text-xs font-mono whitespace-pre-wrap break-all max-h-40 overflow-auto">
                            {alert.content_preview || "(无)"}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            第 {page + 1} / {totalPages} 页
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 text-sm bg-secondary border border-border rounded-md disabled:opacity-30"
            >
              上一页
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 text-sm bg-secondary border border-border rounded-md disabled:opacity-30"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
