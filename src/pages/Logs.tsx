import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/tauri";
import {
  FileText,
  Download,
  Search,
  ChevronDown,
  ChevronRight,
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
}

export default function Logs() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [limit, setLimit] = useState(50);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: logs, isLoading } = useQuery({
    queryKey: ["request-logs", limit],
    queryFn: () =>
      invoke<RequestLog[]>("get_request_logs", { limit, offset: 0 }),
    refetchInterval: 5000,
  });

  const filteredLogs =
    logs?.filter((log) => {
      const matchesSearch =
        searchTerm === "" ||
        log.model.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.provider.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.api_key_used.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus =
        selectedStatus === "all" ||
        (selectedStatus === "success" && log.success) ||
        (selectedStatus === "error" && !log.success);

      return matchesSearch && matchesStatus;
    }) || [];

  const stats = {
    total: filteredLogs.length,
    success: filteredLogs.filter((log) => log.success).length,
    error: filteredLogs.filter((log) => !log.success).length,
    totalTokens: filteredLogs.reduce(
      (sum, log) => sum + log.input_tokens + log.output_tokens,
      0,
    ),
    avgLatency:
      filteredLogs.length > 0
        ? Math.round(
            filteredLogs.reduce((sum, log) => sum + log.latency_ms, 0) /
              filteredLogs.length,
          )
        : 0,
  };

  const formatTimestamp = (timestamp: string) =>
    new Date(timestamp).toLocaleString("zh-CN");
  const formatLatency = (ms: number) =>
    ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
  const formatTokens = (tokens: number) => {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(2)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(2)}K`;
    return tokens.toString();
  };

  const tryFormatJson = (s: string): string => {
    try {
      return JSON.stringify(JSON.parse(s), null, 2);
    } catch {
      return s;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">调用记录</h1>
          <p className="text-muted-foreground mt-2">API 调用历史溯源与审计</p>
        </div>
        <button
          onClick={() =>
            invoke("export_logs", {
              format: "json",
              startDate: "",
              endDate: "",
            })
          }
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
        >
          <Download size={20} />
          <span>导出日志</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card rounded-lg p-4 border border-border">
          <p className="text-sm text-muted-foreground">总请求数</p>
          <p className="text-2xl font-bold">{stats.total}</p>
        </div>
        <div className="bg-card rounded-lg p-4 border border-border">
          <p className="text-sm text-muted-foreground">成功请求</p>
          <p className="text-2xl font-bold text-green-500">{stats.success}</p>
        </div>
        <div className="bg-card rounded-lg p-4 border border-border">
          <p className="text-sm text-muted-foreground">失败请求</p>
          <p className="text-2xl font-bold text-red-500">{stats.error}</p>
        </div>
        <div className="bg-card rounded-lg p-4 border border-border">
          <p className="text-sm text-muted-foreground">平均延迟</p>
          <p className="text-2xl font-bold">
            {formatLatency(stats.avgLatency)}
          </p>
        </div>
      </div>

      <div className="bg-card rounded-lg p-4 border border-border">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              size={20}
            />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜索模型、提供商或 API Key..."
              className="w-full pl-10 pr-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="all">所有状态</option>
            <option value="success">成功</option>
            <option value="error">失败</option>
          </select>
          <select
            value={limit}
            onChange={(e) => setLimit(parseInt(e.target.value))}
            className="px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="20">最近 20 条</option>
            <option value="50">最近 50 条</option>
            <option value="100">最近 100 条</option>
            <option value="500">最近 500 条</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : filteredLogs.length > 0 ? (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-secondary font-medium text-sm">
            <div className="col-span-2">时间</div>
            <div className="col-span-1">提供商</div>
            <div className="col-span-2">模型</div>
            <div className="col-span-1">入/出 Tokens</div>
            <div className="col-span-1">延迟</div>
            <div className="col-span-1">状态</div>
            <div className="col-span-2">来源 IP</div>
            <div className="col-span-1">API Key</div>
            <div className="col-span-1">详情</div>
          </div>

          <div className="divide-y divide-border">
            {filteredLogs.map((log) => {
              const isExpanded = expandedId === log.id;
              return (
                <div key={log.id}>
                  <div
                    className="grid grid-cols-12 gap-2 px-4 py-3 hover:bg-secondary/50 transition-colors items-center text-sm cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : log.id)}
                  >
                    <div className="col-span-2 text-muted-foreground">
                      {formatTimestamp(log.timestamp)}
                    </div>
                    <div className="col-span-1 font-medium truncate">
                      {log.provider}
                    </div>
                    <div className="col-span-2 font-mono text-xs truncate">
                      {log.model}
                    </div>
                    <div className="col-span-1 text-xs">
                      {formatTokens(log.input_tokens)}/
                      {formatTokens(log.output_tokens)}
                    </div>
                    <div className="col-span-1">
                      {formatLatency(log.latency_ms)}
                    </div>
                    <div className="col-span-1">
                      {log.success ? (
                        <span className="text-green-500">OK</span>
                      ) : (
                        <span className="text-red-500">ERR</span>
                      )}
                    </div>
                    <div className="col-span-2 text-muted-foreground truncate">
                      {log.client_ip || "-"}
                    </div>
                    <div className="col-span-1 text-muted-foreground truncate text-xs">
                      {log.api_key_used
                        ? log.api_key_used.slice(0, 12) + "..."
                        : "-"}
                    </div>
                    <div className="col-span-1">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-3">
                      {log.error_message && (
                        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
                          错误: {log.error_message}
                        </div>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">
                            请求内容
                          </p>
                          <pre className="bg-background border border-border rounded-lg p-3 text-xs overflow-auto max-h-64 font-mono whitespace-pre-wrap break-all">
                            {log.request_content
                              ? tryFormatJson(log.request_content)
                              : "(无)"}
                          </pre>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">
                            响应内容
                          </p>
                          <pre className="bg-background border border-border rounded-lg p-3 text-xs overflow-auto max-h-64 font-mono whitespace-pre-wrap break-all">
                            {log.response_content
                              ? tryFormatJson(log.response_content)
                              : "(无)"}
                          </pre>
                        </div>
                      </div>
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
          <p className="text-muted-foreground">
            {searchTerm || selectedStatus !== "all"
              ? "没有找到符合条件的记录"
              : "开始使用 ClamAI 后，调用记录将显示在这里"}
          </p>
        </div>
      )}
    </div>
  );
}
