import React, { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { statsApi } from "../api/stats";
import {
  FileText,
  Search,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  ArrowRight,
  X,
  Download,
  Filter,
  Clock,
  Globe,
  Key,
  User,
} from "lucide-react";

interface RequestLog {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  success: boolean;
  error_message?: string;
  client_ip: string;
  api_key_used: string;
  request_content: string;
  response_content: string;
  status_code: number;
  path: string;
  method: string;
  is_proxy_call?: boolean;
  call_type?: string;
  user_id?: string;
  api_key_id?: string;
  upstream_request_headers?: string;
  upstream_response_headers?: string;
  upstream_request_body?: string;
  upstream_response_body?: string;
  upstream_provider?: string;
  client_request_headers?: string;
  upstream_model?: string;
}

function getStatusInfo(log: RequestLog): { label: string; cls: string } {
  if (log.error_message?.includes("blocked")) return { label: "BLOCKED", cls: "bg-orange-500/10 text-orange-400 border-orange-500/30" };
  if (!log.success) return { label: "ERR", cls: "bg-red-500/10 text-red-400 border-red-500/30" };
  return { label: "OK", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" };
}

function formatHeaders(raw: string): string {
  if (!raw) return "";
  try {
    const obj = JSON.parse(raw);
    return Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join("\n");
  } catch {
    return raw;
  }
}

function tryFormatJson(s: string): string {
  if (!s) return "";
  try {
    const parsed = JSON.parse(s);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return s;
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);
  return (
    <button onClick={handleCopy} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground" title="复制">
      {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
    </button>
  );
}

function SectionPanel({ title, titleColor, headers, body, method, path }: {
  title: string;
  titleColor: string;
  headers?: string;
  body?: string;
  method?: string;
  path?: string;
}) {
  const formattedHeaders = headers ? formatHeaders(headers) : "";
  const formattedBody = body ? tryFormatJson(body) : "";

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className={`px-3 py-1.5 text-xs font-bold ${titleColor} border-b border-border flex items-center gap-2`}>
        {method && <span className="px-1.5 py-0.5 bg-secondary rounded text-foreground font-mono">{method}</span>}
        {path && <span className="font-mono text-muted-foreground">{path}</span>}
        {!method && !path && title}
        {(method || path) && <span className="text-muted-foreground font-normal">— {title}</span>}
      </div>
      {formattedHeaders && (
        <div className="border-b border-border">
          <div className="flex items-center justify-between px-3 py-1 bg-secondary/30">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Headers</span>
            <CopyButton text={formattedHeaders} />
          </div>
          <pre className="px-3 py-2 text-xs font-mono text-foreground whitespace-pre-wrap break-all max-h-40 overflow-auto">
            {formattedHeaders}
          </pre>
        </div>
      )}
      {formattedBody && (
        <div>
          <div className="flex items-center justify-between px-3 py-1 bg-secondary/30">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Body</span>
            <CopyButton text={formattedBody} />
          </div>
          <pre className="px-3 py-2 text-xs font-mono text-foreground whitespace-pre-wrap break-all max-h-80 overflow-auto">
            {formattedBody}
          </pre>
        </div>
      )}
      {!formattedHeaders && !formattedBody && (
        <div className="px-3 py-4 text-xs text-muted-foreground text-center">(无数据)</div>
      )}
    </div>
  );
}

function maskKey(key: string): string {
  if (!key) return "-";
  if (key.length <= 8) return "***";
  return key.slice(0, 6) + "..." + key.slice(-4);
}

const CALL_TYPES = [
  { value: "", label: "全部类型" },
  { value: "direct-call", label: "直接调用" },
  { value: "model-call", label: "模型调用" },
  { value: "client", label: "客户端请求" },
];

const TIME_RANGES = [
  { value: "1h", label: "近1小时" },
  { value: "6h", label: "近6小时" },
  { value: "24h", label: "近24小时" },
  { value: "7d", label: "近7天" },
  { value: "all", label: "全部" },
];

function getTimeRangeParams(range: string): { time_from?: string; time_to?: string } {
  if (range === "all") return {};
  const now = new Date();
  let from: Date;
  switch (range) {
    case "1h": from = new Date(now.getTime() - 3600000); break;
    case "6h": from = new Date(now.getTime() - 6 * 3600000); break;
    case "24h": from = new Date(now.getTime() - 86400000); break;
    case "7d": from = new Date(now.getTime() - 7 * 86400000); break;
    default: from = new Date(now.getTime() - 86400000);
  }
  return { time_from: from.toISOString() };
}

export default function APICallLogs() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedCallType, setSelectedCallType] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedTimeRange, setSelectedTimeRange] = useState("24h");
  const [clientIP, setClientIP] = useState("");
  const [limit, setLimit] = useState(100);
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["api-call-logs", selectedProvider, searchTerm, selectedStatuses, selectedCallType, clientIP, selectedTimeRange, limit, offset],
    queryFn: async () => {
      const timeParams = getTimeRangeParams(selectedTimeRange);
      const result = await statsApi.searchLogs({
        provider: selectedProvider || undefined,
        model: searchTerm || undefined,
        client_ip: clientIP || undefined,
        success: selectedStatuses.length === 1 ? selectedStatuses[0] === "ok" : undefined,
        call_type: selectedCallType || undefined,
        error: undefined,
        limit,
        offset,
        ...timeParams,
      });
      return result;
    },
    refetchInterval: 10000,
  });

  const logs = (data?.logs || []) as unknown as RequestLog[];
  const total = data?.total || 0;

  const toggleStatus = (status: string) => {
    setSelectedStatuses((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
    setOffset(0);
  };

  const filteredLogs = logs?.filter((log) => {
    if (searchTerm && selectedProvider) {
      return log.model.toLowerCase().includes(searchTerm.toLowerCase()) ||
             log.provider.toLowerCase().includes(searchTerm.toLowerCase());
    }
    return true;
  }) || [];

  const stats = {
    total: filteredLogs.length,
    success: filteredLogs.filter((l) => l.success && !l.error_message?.includes("blocked")).length,
    error: filteredLogs.filter((l) => !l.success && !l.error_message?.includes("blocked")).length,
    blocked: filteredLogs.filter((l) => l.error_message?.includes("blocked")).length,
    avgLatency: filteredLogs.length > 0 ? Math.round(filteredLogs.reduce((s, l) => s + l.latency_ms, 0) / filteredLogs.length) : 0,
  };

  const formatTimestamp = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch { return ts; }
  };
  const formatLatency = (ms: number) => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
  const formatTokens = (t: number) => t >= 1_000_000 ? `${(t / 1_000_000).toFixed(1)}M` : t >= 1000 ? `${(t / 1000).toFixed(1)}K` : String(t);

  const hasFilters = selectedStatuses.length > 0 || selectedCallType || selectedProvider || clientIP || searchTerm;
  const clearFilters = () => {
    setSelectedStatuses([]);
    setSelectedCallType("");
    setSelectedProvider("");
    setClientIP("");
    setSearchTerm("");
    setOffset(0);
  };

  const handleExport = () => {
    const headers = ["时间", "类型", "提供商", "模型", "延迟", "状态", "Token", "客户端IP", "路径", "API Key"];
    const rows = filteredLogs.map(log => {
      const statusInfo = getStatusInfo(log);
      return [
        formatTimestamp(log.timestamp),
        log.call_type || "-",
        log.provider,
        log.model,
        String(log.latency_ms),
        statusInfo.label,
        `${log.input_tokens}/${log.output_tokens}`,
        log.client_ip,
        log.path,
        maskKey(log.api_key_used),
      ].join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `api-call-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">API 调用日志</h1>
          <p className="text-sm text-muted-foreground mt-1">审计中心 — 完整的模型调用记录与请求/响应详情</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-secondary border border-border rounded-md hover:bg-secondary/80 text-foreground">
            <Download size={13} /> 导出 CSV
          </button>
          <button onClick={() => setShowFilters(!showFilters)} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-md text-foreground ${showFilters ? "bg-primary/10 border-primary/30" : "bg-secondary border-border hover:bg-secondary/80"}`}>
            <Filter size={13} /> 筛选
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-card rounded-lg p-4 border border-border">
          <p className="text-sm text-muted-foreground">总记录数</p>
          <p className="text-2xl font-bold">{total.toLocaleString()}</p>
        </div>
        <div className="bg-card rounded-lg p-4 border border-border">
          <p className="text-sm text-muted-foreground">成功</p>
          <p className="text-2xl font-bold text-emerald-400">{stats.success}</p>
        </div>
        <div className="bg-card rounded-lg p-4 border border-border">
          <p className="text-sm text-muted-foreground">失败</p>
          <p className="text-2xl font-bold text-red-400">{stats.error}</p>
        </div>
        <div className="bg-card rounded-lg p-4 border border-border">
          <p className="text-sm text-muted-foreground">拦截</p>
          <p className="text-2xl font-bold text-orange-400">{stats.blocked}</p>
        </div>
        <div className="bg-card rounded-lg p-4 border border-border">
          <p className="text-sm text-muted-foreground">平均延迟</p>
          <p className="text-2xl font-bold">{formatLatency(stats.avgLatency)}</p>
        </div>
      </div>

      <div className="bg-card rounded-lg p-4 border border-border space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Clock size={14} className="text-muted-foreground shrink-0" />
            <select value={selectedTimeRange} onChange={(e) => { setSelectedTimeRange(e.target.value); setOffset(0); }}
              className="px-3 py-1.5 bg-secondary border border-border rounded-md text-sm text-foreground">
              {TIME_RANGES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
            <input type="text" value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setOffset(0); }}
              placeholder="搜索模型 / 提供商..."
              className="w-full pl-8 pr-3 py-1.5 bg-secondary border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground" />
          </div>
          <select value={limit} onChange={(e) => { setLimit(parseInt(e.target.value)); setOffset(0); }}
            className="px-3 py-1.5 bg-secondary border border-border rounded-md text-sm text-foreground">
            <option value="50">50条/页</option>
            <option value="100">100条/页</option>
            <option value="200">200条/页</option>
            <option value="500">500条/页</option>
          </select>
          {hasFilters && (
            <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <X size={12} /> 清除筛选
            </button>
          )}
        </div>

        {showFilters && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t border-border">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground shrink-0">提供商:</span>
              <input type="text" value={selectedProvider} onChange={(e) => { setSelectedProvider(e.target.value); setOffset(0); }}
                placeholder="siliconflow"
                className="flex-1 px-2 py-1 bg-secondary border border-border rounded text-xs text-foreground" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground shrink-0">客户端IP:</span>
              <input type="text" value={clientIP} onChange={(e) => { setClientIP(e.target.value); setOffset(0); }}
                placeholder="192.168.x.x"
                className="flex-1 px-2 py-1 bg-secondary border border-border rounded text-xs text-foreground" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground shrink-0">调用类型:</span>
              <select value={selectedCallType} onChange={(e) => { setSelectedCallType(e.target.value); setOffset(0); }}
                className="flex-1 px-2 py-1 bg-secondary border border-border rounded text-xs text-foreground">
                {CALL_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground shrink-0">状态:</span>
              <div className="flex gap-1">
                {["ok", "err", "blocked"].map(s => (
                  <button key={s} onClick={() => { toggleStatus(s); setOffset(0); }}
                    className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
                      selectedStatuses.includes(s)
                        ? s === "ok" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                          : s === "err" ? "bg-red-500/10 text-red-400 border-red-500/30"
                            : "bg-orange-500/10 text-orange-400 border-orange-500/30"
                        : "bg-secondary text-muted-foreground border-border"
                    }`}>
                    {s === "ok" ? "OK" : s === "err" ? "ERR" : "BLOCKED"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
      ) : logs.length > 0 ? (
        <>
          <div className="bg-card rounded-lg border border-border overflow-hidden">
            <div className="grid grid-cols-[40px_130px_70px_75px_1fr_65px_55px_80px_30px] gap-1 px-4 py-2.5 bg-secondary font-medium text-[11px] text-muted-foreground items-center">
              <span>ID</span><span>时间</span><span>类型</span><span>提供商</span><span>模型</span><span>延迟</span><span>状态</span><span>Token</span><span></span>
            </div>
            <div className="divide-y divide-border">
              {logs.map((log) => {
                const isExpanded = expandedId === String(log.id);
                const statusInfo = getStatusInfo(log);
                return (
                  <div key={log.id}>
                    <div
                      className={`grid grid-cols-[40px_130px_70px_75px_1fr_65px_55px_80px_30px] gap-1 px-4 py-2 hover:bg-secondary/50 transition-colors items-center text-sm cursor-pointer ${isExpanded ? "bg-secondary/30" : ""}`}
                      onClick={() => setExpandedId(isExpanded ? null : String(log.id))}
                    >
                      <span className="text-xs text-muted-foreground truncate">{log.id}</span>
                      <span className="text-[11px] text-muted-foreground">{formatTimestamp(log.timestamp)}</span>
                      <span>
                        {log.call_type === "security" || (log.path || "").includes("security") ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/10 text-purple-400">安全</span>
                        ) : log.call_type === "model-call" || log.is_proxy_call || log.upstream_provider ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/10 text-blue-400">模型</span>
                        ) : log.call_type === "direct-call" ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400">直连</span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-gray-500/10 text-gray-400">请求</span>
                        )}
                      </span>
                      <span className="text-xs font-medium truncate">{log.provider}</span>
                      <span className="font-mono text-[11px] truncate">{log.model}</span>
                      <span className="text-xs text-muted-foreground">{formatLatency(log.latency_ms)}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${statusInfo.cls}`}>{statusInfo.label}</span>
                      <span className="text-[11px] text-muted-foreground">{log.input_tokens + log.output_tokens > 0 ? `${formatTokens(log.input_tokens)}/${formatTokens(log.output_tokens)}` : "-"}</span>
                      <span className="text-muted-foreground">{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                    </div>

                    {isExpanded && (
                      <div className="px-4 pb-4 space-y-4">
                        <div className="flex items-center gap-4 text-xs text-muted-foreground bg-secondary/30 px-4 py-2 rounded-md">
                          <span className="flex items-center gap-1"><Globe size={11} /> {log.client_ip || "-"}</span>
                          <span className="flex items-center gap-1"><Key size={11} /> {maskKey(log.api_key_used)}</span>
                          {log.user_id && <span className="flex items-center gap-1"><User size={11} /> {log.user_id}</span>}
                          {log.upstream_provider && <span className="text-purple-400">→ {log.upstream_provider}/{log.upstream_model || log.model}</span>}
                          <span className="ml-auto">HTTP {log.status_code || 200}</span>
                        </div>

                        {log.error_message && (
                          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
                            错误: {log.error_message}
                          </div>
                        )}

                        {(log.call_type === "security" || (log.path || "").includes("security")) ? (
                          <div className="space-y-3">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-purple-400" /> 安全分析
                            </h4>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                              <SectionPanel title="Request" titleColor="bg-blue-500/10 text-blue-400" method={log.method || "POST"} path={log.path || "/security/semantic-check"} body={log.request_content} />
                              <SectionPanel title="Response" titleColor="bg-emerald-500/10 text-emerald-400" body={log.response_content} />
                            </div>
                          </div>
                        ) : (log.call_type === "model-call" || log.is_proxy_call || log.upstream_provider) ? (
                          <div className="space-y-4">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-blue-400" /> 模型调用
                            </h4>
                            <div className="space-y-3">
                              <div>
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="text-xs font-semibold text-emerald-400">① 客户端请求</span>
                                  <span className="text-[10px] text-muted-foreground">(原始请求)</span>
                                </div>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                                  <SectionPanel title="Request" titleColor="bg-blue-500/10 text-blue-400" method={log.method || "POST"} path={log.path || "/v1/chat/completions"} headers={log.client_request_headers} body={log.request_content} />
                                  <SectionPanel title="Response" titleColor={log.success ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"} headers={JSON.stringify({ "Status-Code": String(log.status_code || 200), "Content-Type": "application/json" })} body={log.response_content} />
                                </div>
                              </div>
                              <div className="flex items-center gap-2 px-2">
                                <div className="flex-1 border-t border-border" />
                                <ArrowRight size={14} className="text-muted-foreground" />
                                <span className="text-[10px] text-muted-foreground">→ {log.upstream_provider || "上游"}</span>
                                <ArrowRight size={14} className="text-muted-foreground" />
                                <div className="flex-1 border-t border-border" />
                              </div>
                              <div>
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="text-xs font-semibold text-purple-400">② 上游转发</span>
                                  <span className="text-[10px] text-muted-foreground">(→ {log.upstream_model || log.model})</span>
                                </div>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                                  <SectionPanel title="Request" titleColor="bg-blue-500/10 text-blue-400" method="POST" path="/v1/chat/completions" headers={log.upstream_request_headers} body={log.upstream_request_body || log.request_content} />
                                  <SectionPanel title="Response" titleColor="bg-emerald-500/10 text-emerald-400" headers={log.upstream_response_headers} body={log.upstream_response_body || log.response_content} />
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-gray-400" /> 客户端请求
                            </h4>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                              <SectionPanel title="Request" titleColor="bg-blue-500/10 text-blue-400" method={log.method || "POST"} path={log.path || "/v1/chat/completions"} headers={(() => { try { JSON.parse(log.request_content || "{}"); return JSON.stringify({ "Content-Type": "application/json", "X-API-Key": maskKey(log.api_key_used), "X-Client-IP": log.client_ip || "" }); } catch { return ""; } })()} body={log.request_content} />
                              <SectionPanel title="Response" titleColor={log.success ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"} headers={JSON.stringify({ "Status-Code": String(log.status_code || 200), "Content-Type": "application/json" })} body={log.response_content} />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                共 {total.toLocaleString()} 条，第 {currentPage}/{totalPages} 页
              </span>
              <div className="flex items-center gap-2">
                <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}
                  className="px-3 py-1 text-xs bg-secondary border border-border rounded-md disabled:opacity-30 hover:bg-secondary/80">
                  上一页
                </button>
                <span className="text-xs text-muted-foreground px-2">
                  第 {currentPage} / {totalPages} 页
                </span>
                <button disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}
                  className="px-3 py-1 text-xs bg-secondary border border-border rounded-md disabled:opacity-30 hover:bg-secondary/80">
                  下一页
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-12">
          <FileText className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">暂无记录</h3>
          <p className="text-muted-foreground">当前筛选条件下没有找到调用记录</p>
        </div>
      )}
    </div>
  );
}