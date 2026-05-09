import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { statsApi } from "../api/stats";
import {
  Search,
  RefreshCw,
  Server,
} from "lucide-react";

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

export default function SystemLogs() {
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">系统运行日志</h1>
        <p className="text-sm text-muted-foreground mt-1">查看网关服务运行日志，排查问题与监控状态</p>
      </div>

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
    </div>
  );
}
