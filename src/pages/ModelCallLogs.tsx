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
  upstream_request_headers?: string;
  upstream_response_headers?: string;
  upstream_request_body?: string;
  upstream_response_body?: string;
  upstream_provider?: string;
  upstream_model?: string;
  client_request_headers?: string;
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

const STATUS_OPTIONS = [
  { value: "ok", label: "OK" },
  { value: "err", label: "ERR" },
  { value: "blocked", label: "BLOCKED" },
];

const TYPE_OPTIONS = [
  { value: "", label: "全部类型" },
  { value: "direct-call", label: "直接调用" },
  { value: "model-call", label: "模型调用" },
  { value: "security", label: "安全分析" },
];

export default function ModelCallLogs() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedType, setSelectedType] = useState("");
  const [limit, setLimit] = useState(50);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: logs, isLoading } = useQuery({
    queryKey: ["request-logs", limit],
    queryFn: async () => {
      const result = await statsApi.logs({ limit });
      return (result.logs || []) as unknown as RequestLog[];
    },
    refetchInterval: 5000,
  });

  const toggleStatus = (status: string) => {
    setSelectedStatuses((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
  };

  const filteredLogs =
    logs?.filter((log) => {
      const matchesSearch =
        searchTerm === "" ||
        log.model.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.provider.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.api_key_used.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.error_message?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus =
        selectedStatuses.length === 0 ||
        selectedStatuses.some((s) => {
          if (s === "ok") return log.success && !log.error_message?.includes("blocked");
          if (s === "err") return !log.success && !log.error_message?.includes("blocked");
          if (s === "blocked") return log.error_message?.includes("blocked");
          return false;
        });
      const matchesType =
        selectedType === "" ||
        (selectedType === "security" && ((log.call_type || "").includes("security") || (log.path || "").includes("security"))) ||
        (selectedType === "model-call" && ((log.call_type === "model-call") || log.is_proxy_call || !!log.upstream_provider)) ||
        (selectedType === "direct-call" && log.call_type === "direct-call");
      return matchesSearch && matchesStatus && matchesType;
    }) || [];

  const stats = {
    total: filteredLogs.length,
    success: filteredLogs.filter((l) => l.success && !l.error_message?.includes("blocked")).length,
    error: filteredLogs.filter((l) => !l.success && !l.error_message?.includes("blocked")).length,
    blocked: filteredLogs.filter((l) => l.error_message?.includes("blocked")).length,
    avgLatency: filteredLogs.length > 0 ? Math.round(filteredLogs.reduce((s, l) => s + l.latency_ms, 0) / filteredLogs.length) : 0,
  };

  const formatTimestamp = (ts: string) => new Date(ts).toLocaleString("zh-CN");
  const formatLatency = (ms: number) => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
  const formatTokens = (t: number) => t >= 1_000_000 ? `${(t / 1_000_000).toFixed(2)}M` : t >= 1000 ? `${(t / 1000).toFixed(2)}K` : String(t);

  const hasFilters = selectedStatuses.length > 0 || selectedType || searchTerm;
  const clearFilters = () => {
    setSelectedStatuses([]);
    setSelectedType("");
    setSearchTerm("");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">模型调用日志</h1>
        <p className="text-sm text-muted-foreground mt-1">查看所有模型调用的详细记录与请求/响应内容</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card rounded-lg p-4 border border-border">
          <p className="text-sm text-muted-foreground">总请求数</p>
          <p className="text-2xl font-bold">{stats.total}</p>
        </div>
        <div className="bg-card rounded-lg p-4 border border-border">
          <p className="text-sm text-muted-foreground">成功</p>
          <p className="text-2xl font-bold text-emerald-400">{stats.success}</p>
        </div>
        <div className="bg-card rounded-lg p-4 border border-border">
          <p className="text-sm text-muted-foreground">失败 / 拦截</p>
          <p className="text-2xl font-bold"><span className="text-red-400">{stats.error}</span> / <span className="text-orange-400">{stats.blocked}</span></p>
        </div>
        <div className="bg-card rounded-lg p-4 border border-border">
          <p className="text-sm text-muted-foreground">平均延迟</p>
          <p className="text-2xl font-bold">{formatLatency(stats.avgLatency)}</p>
        </div>
      </div>

      <div className="bg-card rounded-lg p-4 border border-border space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Search size={14} />
          <span>筛选条件</span>
          {hasFilters && (
            <button onClick={clearFilters} className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <X size={12} /> 清除筛选
            </button>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">状态:</span>
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => toggleStatus(opt.value)}
                className={`px-2 py-1 rounded text-xs border transition-colors ${
                  selectedStatuses.includes(opt.value)
                    ? opt.value === "ok" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                      : opt.value === "err" ? "bg-red-500/10 text-red-400 border-red-500/30"
                        : "bg-orange-500/10 text-orange-400 border-orange-500/30"
                    : "bg-secondary text-muted-foreground border-border"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)}
            className="px-3 py-1.5 bg-secondary border border-border rounded-md text-sm text-foreground">
            {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
            <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="搜索模型、提供商、Key..."
              className="w-full pl-8 pr-3 py-1.5 bg-secondary border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground" />
          </div>
          <select value={limit} onChange={(e) => setLimit(parseInt(e.target.value))}
            className="px-3 py-1.5 bg-secondary border border-border rounded-md text-sm text-foreground">
            <option value="20">20条</option><option value="50">50条</option><option value="100">100条</option><option value="500">500条</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
      ) : filteredLogs.length > 0 ? (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <div className="grid grid-cols-[40px_140px_75px_80px_1fr_65px_55px_90px_30px] gap-1 px-4 py-2.5 bg-secondary font-medium text-[11px] text-muted-foreground items-center">
            <span>ID</span><span>时间</span><span>类型</span><span>提供商</span><span>模型</span><span>延迟</span><span>状态</span><span>Token</span><span></span>
          </div>
          <div className="divide-y divide-border">
            {filteredLogs.map((log) => {
              const isExpanded = expandedId === String(log.id);
              const statusInfo = getStatusInfo(log);
              return (
                <div key={log.id}>
                  <div
                    className={`grid grid-cols-[40px_140px_75px_80px_1fr_65px_55px_90px_30px] gap-1 px-4 py-2 hover:bg-secondary/50 transition-colors items-center text-sm cursor-pointer ${isExpanded ? "bg-secondary/30" : ""}`}
                    onClick={() => setExpandedId(isExpanded ? null : String(log.id))}
                  >
                    <span className="text-xs text-muted-foreground">{log.id}</span>
                    <span className="text-[11px] text-muted-foreground">{formatTimestamp(log.timestamp)}</span>
                    <span>
                      {log.call_type === "security" || (log.path || "").includes("security") ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/10 text-purple-400">安全分析</span>
                      ) : (log.call_type === "model-call" || log.is_proxy_call || log.upstream_provider) ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/10 text-blue-400">模型调用</span>
                      ) : log.call_type === "direct-call" ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400">直接调用</span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-gray-500/10 text-gray-400">客户端请求</span>
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
                            <SectionPanel title="Request" titleColor="bg-blue-500/10 text-blue-400" method={log.method || "POST"} path={log.path || "/security/semantic-check"} headers={log.upstream_request_headers} body={log.request_content} />
                            <SectionPanel title="Response" titleColor="bg-emerald-500/10 text-emerald-400" headers={log.upstream_response_headers} body={log.response_content} />
                          </div>
                        </div>
                      ) : (log.call_type === "model-call" || log.is_proxy_call || log.upstream_provider) ? (
                          <div className="space-y-4">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-blue-400" /> 模型调用
                            </h4>
                          <div className="grid grid-cols-1 gap-4">
                            <div>
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-xs font-semibold text-emerald-400">① 客户端请求</span>
                                <span className="text-[10px] text-muted-foreground">(原始请求)</span>
                              </div>
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                                <SectionPanel title="Request" titleColor="bg-blue-500/10 text-blue-400" method={log.method || "POST"} path={log.path || "/v1/chat/completions"} headers={log.client_request_headers} body={log.request_content} />
                                <SectionPanel title="Response" titleColor={`bg-${log.success ? "emerald" : "red"}-500/10 text-${log.success ? "emerald" : "red"}-400`} headers={JSON.stringify({ "Status-Code": String(log.status_code || 200), "Content-Type": "application/json" })} body={log.response_content} />
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
                      ) : log.call_type === "direct-call" ? (
                        <div className="space-y-3">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-400" /> 直接调用
                          </h4>
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                            <SectionPanel title="Request" titleColor="bg-blue-500/10 text-blue-400" method={log.method || "POST"} path={log.path || "/v1/chat/completions"} headers={(() => { try { JSON.parse(log.request_content || "{}"); return JSON.stringify({ "Content-Type": "application/json", "X-API-Key": log.api_key_used ? log.api_key_used.slice(0, 10) + "..." : "", "X-Client-IP": log.client_ip || "" }); } catch { return ""; } })()} body={log.request_content} />
                            <SectionPanel title="Response" titleColor={`bg-${log.success ? "emerald" : "red"}-500/10 text-${log.success ? "emerald" : "red"}-400`} headers={JSON.stringify({ "Status-Code": String(log.status_code || 200), "Content-Type": "application/json" })} body={log.response_content} />
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-gray-400" /> 客户端请求
                          </h4>
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                            <SectionPanel title="Request" titleColor="bg-blue-500/10 text-blue-400" method={log.method || "POST"} path={log.path || "/v1/chat/completions"} headers={(() => { try { JSON.parse(log.request_content || "{}"); return JSON.stringify({ "Content-Type": "application/json", "X-API-Key": log.api_key_used ? log.api_key_used.slice(0, 10) + "..." : "", "X-Client-IP": log.client_ip || "" }); } catch { return ""; } })()} body={log.request_content} />
                            <SectionPanel title="Response" titleColor={`bg-${log.success ? "emerald" : "red"}-500/10 text-${log.success ? "emerald" : "red"}-400`} headers={JSON.stringify({ "Status-Code": String(log.status_code || 200), "Content-Type": "application/json" })} body={log.response_content} />
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
      ) : (
        <div className="text-center py-12">
          <FileText className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">暂无记录</h3>
          <p className="text-muted-foreground">开始使用 ClamAI 后，调用记录将显示在这里</p>
        </div>
      )}
    </div>
  );
}
