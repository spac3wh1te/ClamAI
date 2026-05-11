import React, { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { statsApi } from "../api/stats";
import {
  Search,
  RefreshCw,
  Server,
  ChevronRight,
  ChevronDown,
  Copy,
  Check,
} from "lucide-react";

function getLevelColor(line: string): string {
  if (line.includes("[ERROR]") || line.includes(`"level":"ERROR"`)) return "text-red-400";
  if (line.includes("[WARN]") || line.includes(`"level":"WARN"`)) return "text-amber-400";
  if (line.includes("[DEBUG]") || line.includes(`"level":"DEBUG"`)) return "text-blue-400";
  if (line.includes("[TRACE]") || line.includes(`"level":"TRACE"`)) return "text-muted-foreground";
  return "text-foreground";
}

function getLevelBadge(line: string): { label: string; cls: string } | null {
  if (line.includes("[ERROR]") || line.includes(`"level":"ERROR"`)) return { label: "ERROR", cls: "bg-red-500/10 text-red-400 border-red-500/30" };
  if (line.includes("[WARN]") || line.includes(`"level":"WARN"`)) return { label: "WARN", cls: "bg-amber-500/10 text-amber-400 border-amber-500/30" };
  if (line.includes("[DEBUG]") || line.includes(`"level":"DEBUG"`)) return { label: "DEBUG", cls: "bg-blue-500/10 text-blue-400 border-blue-500/30" };
  if (line.includes("[TRACE]") || line.includes(`"level":"TRACE"`)) return { label: "TRACE", cls: "bg-secondary text-muted-foreground border-border" };
  if (line.includes("[INFO]") || line.includes(`"level":"INFO"`)) return { label: "INFO", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" };
  return null;
}

function extractTime(line: string): string {
  const m = line.match(/"time"\s*:\s*"([^"]+)"/);
  if (m) {
    try {
      const d = new Date(m[1]);
      if (!isNaN(d.getTime())) {
        const p = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
      }
    } catch {}
    const s = m[1].replace(/\+.*$/, "");
    const datePart = s.replace(/^.*?(\d{4}-\d{2}-\d{2})/, "$1").replace(/-/g, "/");
    const timePart = s.replace(/^.*T(\d{2}:\d{2}:\d{2}).*/, "$1");
    if (datePart && timePart) return `${datePart} ${timePart}`;
    return s;
  }
  const m2 = line.match(/(\d{4})[/-](\d{2})[/-](\d{2})\s+(\d{2}:\d{2}:\d{2})/);
  if (m2) return `${m2[1]}/${parseInt(m2[2])}/${parseInt(m2[3])} ${m2[4]}`;
  return "";
}

function extractMsg(line: string): string {
  const m = line.match(/"msg"\s*:\s*"([^"]*)"/);
  if (m) return m[1];
  return line.replace(/^\S+\s+\S+\s+/, "");
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);
  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors shrink-0"
      title="复制"
    >
      {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
    </button>
  );
}

export default function SystemLogs() {
  const [level, setLevel] = useState<string>("");
  const [keyword, setKeyword] = useState<string>("");
  const [limit, setLimit] = useState(200);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

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
        <h1 className="text-2xl font-bold">平台运行日志</h1>
        <p className="text-sm text-muted-foreground mt-1">查看服务运行日志，排查问题与监控状态</p>
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
          <div className="flex gap-2">
            <button
              onClick={() => setAutoRefresh((v) => !v)}
              className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors flex-1 ${
                autoRefresh ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" : "bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-transparent"
              }`}
            >
              <RefreshCw size={14} className={isFetching && autoRefresh ? "animate-spin" : ""} />
              {autoRefresh ? "停止刷新" : "自动刷新"}
            </button>
            <button onClick={() => refetch()} disabled={isFetching}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 disabled:opacity-50">
              <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} /> 刷新
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>共 {total} 行{level ? ` (${level}级别)` : ""}{keyword ? ` 匹配"${keyword}"` : ""}</span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
      ) : lines.length > 0 ? (
        <div className="bg-card rounded-lg border border-border overflow-hidden text-xs">
          <div className="divide-y divide-border max-h-[70vh] overflow-y-auto">
            {lines.map((line, i) => {
              const badge = getLevelBadge(line);
              const time = extractTime(line);
              const msg = extractMsg(line);
              const isExpanded = expandedIdx === i;
              return (
                <div key={i}>
                  <div
                    className={`flex items-center gap-3 px-3 py-1.5 ${getLevelColor(line)} hover:bg-secondary/30 cursor-pointer group`}
                    onClick={() => setExpandedIdx(isExpanded ? null : i)}
                  >
                    <span className="text-muted-foreground shrink-0">
                      {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </span>
                    {time && <span className="text-muted-foreground font-mono shrink-0 min-w-[150px] text-[11px]">{time}</span>}
                    {badge && <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 border ${badge.cls}`}>{badge.label}</span>}
                    <span className="truncate flex-1 font-mono text-[11px]" title={msg}>{msg.length > 120 ? msg.slice(0, 120) + "..." : msg}</span>
                    <CopyButton text={line} />
                  </div>
                  {isExpanded && (
                    <div className="px-3 pb-3 pt-1">
                      <pre className="bg-background border border-border rounded-lg p-3 font-mono text-xs whitespace-pre-wrap break-all leading-relaxed select-all">
                        {line}
                      </pre>
                    </div>
                  )}
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
