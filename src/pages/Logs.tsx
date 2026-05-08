import React, { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { statsApi } from "../api/stats";
import { useCurrentUser } from "../context/UserContext";
import {
  FileText,
  Search,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Server,
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
}

function getLevelColor(line: string): string {
  if (line.includes("[ERROR]") || line.includes(`"level":"ERROR"`)) return "text-red-400";
  if (line.includes("[WARN]") || line.includes(`"level":"WARN"`)) return "text-amber-400";
  if (line.includes("[DEBUG]") || line.includes(`"level":"DEBUG"`)) return "text-blue-400";
  if (line.includes("[TRACE]") || line.includes(`"level":"TRACE"`)) return "text-muted-foreground";
  return "text-foreground";
}

function getLevelBadge(line: string): { label: string; cls: string } | null {
  if (line.includes("[ERROR]") || line.includes(`"level":"ERROR"`)) return { label: "ERROR", cls: "bg-red-500/10 text-red-400" };
  if (line.includes("[WARN]") || line.includes(`"level":"WARN"`)) return { label: "WARN", cls: "bg-amber-500/10 text-amber-400" };
  if (line.includes("[DEBUG]") || line.includes(`"level":"DEBUG"`)) return { label: "DEBUG", cls: "bg-blue-500/10 text-blue-400" };
  if (line.includes("[TRACE]") || line.includes(`"level":"TRACE"`)) return { label: "TRACE", cls: "bg-secondary text-muted-foreground" };
  if (line.includes("[INFO]") || line.includes(`"level":"INFO"`)) return { label: "INFO", cls: "bg-emerald-500/10 text-emerald-400" };
  return null;
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

function tryExtractJsonBody(s: string): { body: string; headers: string } {
  if (!s) return { body: "", headers: "" };
  try {
    const parsed = JSON.parse(s);
    const headers: Record<string, string> = {};
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (k.toLowerCase().startsWith("content-") || k.toLowerCase() === "authorization" || k.toLowerCase() === "host" || k.toLowerCase() === "user-agent" || k.toLowerCase() === "accept") {
        headers[k] = v as string;
      } else {
        body[k] = v;
      }
    }
    const headerStr = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\n");
    const bodyStr = Object.keys(body).length > 0 ? JSON.stringify(body, null, 2) : "";
    return { body: bodyStr, headers: headerStr };
  } catch {
    return { body: s, headers: "" };
  }
}

function getStatusInfo(log: RequestLog): { label: string; cls: string } {
  if (log.error_message?.includes("blocked")) return { label: "BLOCKED", cls: "bg-orange-500/10 text-orange-400 border-orange-500/30" };
  if (!log.success) return { label: "ERR", cls: "bg-red-500/10 text-red-400 border-red-500/30" };
  return { label: "OK", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" };
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

export default function Logs() {
  const [tab, setTab] = useState<"request" | "service">("request");
  const { isAdmin } = useCurrentUser();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">日志</h1>
          <p className="text-muted-foreground mt-2">调用记录{isAdmin && "与服务日志"}查询</p>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setTab("request")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === "request" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}
        >
          <span className="flex items-center gap-2"><FileText size={14} /> 调用日志</span>
        </button>
        {isAdmin && (
        <button
          onClick={() => setTab("service")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === "service" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}
        >
          <span className="flex items-center gap-2"><Server size={14} /> 服务日志</span>
        </button>
        )}
      </div>

      {tab === "request" && <RequestLogsTab />}
      {tab === "service" && isAdmin && <ServiceLogsTab />}
    </div>
  );
}

function RequestLogsTab() {
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
    <>
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
                            <SectionPanel
                              title="Request"
                              titleColor="bg-blue-500/10 text-blue-400"
                              method={log.method || "POST"}
                              path={log.path || "/security/semantic-check"}
                              body={log.request_content}
                            />
                            <SectionPanel
                              title="Response"
                              titleColor="bg-emerald-500/10 text-emerald-400"
                              body={log.response_content}
                            />
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
                                <SectionPanel
                                  title="Request"
                                  titleColor="bg-blue-500/10 text-blue-400"
                                  method={log.method || "POST"}
                                  path={log.path || "/v1/chat/completions"}
                                  headers={log.upstream_request_headers}
                                  body={log.request_content}
                                />
                                <SectionPanel
                                  title="Response"
                                  titleColor={`bg-${log.success ? "emerald" : "red"}-500/10 text-${log.success ? "emerald" : "red"}-400`}
                                  headers={JSON.stringify({ "Status-Code": String(log.status_code || 200), "Content-Type": "application/json" })}
                                  body={log.response_content}
                                />
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
                                <SectionPanel
                                  title="Request"
                                  titleColor="bg-blue-500/10 text-blue-400"
                                  method="POST"
                                  path="/v1/chat/completions"
                                  headers={log.upstream_request_headers}
                                  body={log.upstream_request_body || log.request_content}
                                />
                                <SectionPanel
                                  title="Response"
                                  titleColor="bg-emerald-500/10 text-emerald-400"
                                  headers={log.upstream_response_headers}
                                  body={log.upstream_response_body || log.response_content}
                                />
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
                            <SectionPanel
                              title="Request"
                              titleColor="bg-blue-500/10 text-blue-400"
                              method={log.method || "POST"}
                              path={log.path || "/v1/chat/completions"}
                              headers={(() => {
                                try {
                                  const body = JSON.parse(log.request_content || "{}");
                                  return JSON.stringify({ "Content-Type": "application/json", "X-API-Key": log.api_key_used ? log.api_key_used.slice(0, 10) + "..." : "", "X-Client-IP": log.client_ip || "" });
                                } catch { return ""; }
                              })()}
                              body={log.request_content}
                            />
                            <SectionPanel
                              title="Response"
                              titleColor={`bg-${log.success ? "emerald" : "red"}-500/10 text-${log.success ? "emerald" : "red"}-400`}
                              headers={(() => {
                                return JSON.stringify({ "Status-Code": String(log.status_code || 200), "Content-Type": "application/json" });
                              })()}
                              body={log.response_content}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-gray-400" /> 客户端请求
                          </h4>
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                            <SectionPanel
                              title="Request"
                              titleColor="bg-blue-500/10 text-blue-400"
                              method={log.method || "POST"}
                              path={log.path || "/v1/chat/completions"}
                              headers={(() => {
                                try {
                                  const body = JSON.parse(log.request_content || "{}");
                                  return JSON.stringify({ "Content-Type": "application/json", "X-API-Key": log.api_key_used ? log.api_key_used.slice(0, 10) + "..." : "", "X-Client-IP": log.client_ip || "" });
                                } catch { return ""; }
                              })()}
                              body={log.request_content}
                            />
                            <SectionPanel
                              title="Response"
                              titleColor={`bg-${log.success ? "emerald" : "red"}-500/10 text-${log.success ? "emerald" : "red"}-400`}
                              headers={(() => {
                                return JSON.stringify({ "Status-Code": String(log.status_code || 200), "Content-Type": "application/json" });
                              })()}
                              body={log.response_content}
                            />
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
    </>
  );
}

function ServiceLogsTab() {
  const [level, setLevel] = useState<string>("");
  const [keyword, setKeyword] = useState<string>("");
  const [limit, setLimit] = useState(200);

  const [autoRefresh, setAutoRefresh] = useState(false);
  const { data: serviceLogs, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["service-logs", level, keyword, limit],
    queryFn: () => statsApi.serviceLogs({ level: level || undefined, keyword: keyword || undefined, limit }),
    refetchInterval: autoRefresh ? 10000 : 0,
    staleTime: 0,
  });

  const lines = serviceLogs?.lines || [];
  const total = serviceLogs?.total || 0;

  return (
    <>
      <div className="bg-card rounded-lg p-4 border border-border">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
            <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索关键词..."
              className="w-full pl-10 pr-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
          <select value={level} onChange={(e) => setLevel(e.target.value)}
            className="px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary">
            <option value="">所有级别</option>
            <option value="ERROR">ERROR</option>
            <option value="WARN">WARN</option>
            <option value="INFO">INFO</option>
            <option value="DEBUG">DEBUG</option>
            <option value="TRACE">TRACE</option>
          </select>
          <select value={limit} onChange={(e) => setLimit(parseInt(e.target.value))}
            className="px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary">
            <option value="50">最近 50 行</option>
            <option value="200">最近 200 行</option>
            <option value="500">最近 500 行</option>
            <option value="1000">最近 1000 行</option>
          </select>
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
              autoRefresh ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" : "bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-transparent"
            }`}
          >
            <RefreshCw size={14} className={isFetching && autoRefresh ? "animate-spin" : ""} />
            {autoRefresh ? "自动刷新" : "自动刷新"}
          </button>
          <button onClick={() => refetch()} disabled={isFetching}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 disabled:opacity-50">
            <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} /> 刷新
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>共 {total} 行{level ? ` (${level}级别)` : ""}{keyword ? ` 匹配"${keyword}"` : ""}</span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
      ) : lines.length > 0 ? (
        <div className="bg-card rounded-lg border border-border overflow-hidden font-mono text-xs">
          <div className="divide-y divide-border max-h-[70vh] overflow-y-auto">
            {lines.map((line, i) => {
              const badge = getLevelBadge(line);
              return (
                <div key={i} className={`px-4 py-1.5 ${getLevelColor(line)} hover:bg-secondary/30 break-all`}>
                  {badge && <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold mr-2 ${badge.cls}`}>{badge.label}</span>}
                  {line}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="text-center py-12">
          <Server className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">暂无服务日志</h3>
          <p className="text-muted-foreground">服务启动后日志将显示在这里</p>
        </div>
      )}
    </>
  );
}
