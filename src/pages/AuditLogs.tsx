import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../api/client";
import { ClipboardList, Search, User, RefreshCw, Loader2 } from "lucide-react";

interface AuditEntry {
  id: number;
  created_at: string;
  username: string;
  action: string;
  target: string;
  detail: string;
  source_ip: string;
}

const actionLabels: Record<string, string> = {
  "user.create": "创建用户",
  "user.update": "更新用户",
  "user.delete": "删除用户",
  "user.reset_password": "重置密码",
  "apikey.create": "创建 API Key",
  "apikey.update": "更新 API Key",
  "apikey.delete": "删除 API Key",
  "provider.create": "添加 Provider",
  "provider.update": "更新 Provider",
  "provider.delete": "删除 Provider",
  "config.save": "保存配置",
  "config.reset": "重置配置",
  "security.config_update": "更新安全配置",
  "settings.registration": "注册开关",
  "app.restart": "重启服务",
};

const actionColors: Record<string, string> = {
  "user.create": "bg-emerald-500/10 text-emerald-400",
  "user.delete": "bg-red-500/10 text-red-400",
  "user.update": "bg-blue-500/10 text-blue-400",
  "user.reset_password": "bg-amber-500/10 text-amber-400",
  "apikey.create": "bg-emerald-500/10 text-emerald-400",
  "apikey.delete": "bg-red-500/10 text-red-400",
  "provider.create": "bg-emerald-500/10 text-emerald-400",
  "provider.delete": "bg-red-500/10 text-red-400",
  "config.save": "bg-blue-500/10 text-blue-400",
  "config.reset": "bg-red-500/10 text-red-400",
  "app.restart": "bg-amber-500/10 text-amber-400",
};

function formatTarget(action: string, target: string): string {
  if (!target) {
    const actionTargetLabels: Record<string, string> = {
      "config.save": "全局配置",
      "config.reset": "全局配置",
      "config.backup": "配置备份",
      "config.restore": "配置恢复",
      "security.config_update": "安全防护配置",
      "app.restart": "服务重启",
      "settings.registration": "开放注册",
    };
    return actionTargetLabels[action] || "\u2014";
  }
  const actionCtx: Record<string, string> = {
    "user.create": "\u7528\u6237",
    "user.update": "\u7528\u6237",
    "user.delete": "\u7528\u6237",
    "user.reset_password": "\u7528\u6237",
    "apikey.create": "API Key",
    "apikey.update": "API Key",
    "apikey.delete": "API Key",
    "provider.create": "Provider",
    "provider.update": "Provider",
    "provider.delete": "Provider",
    "session.revoke": "\u4F1A\u8BDD",
  };
  const prefix = actionCtx[action];
  if (prefix && target.length > 12 && !/[\u4e00-\u9fa5]/.test(target)) {
    return `${prefix}(${target.slice(0, 8)}...)`;
  }
  return target;
}

function formatDetail(detail: string): string {
  if (!detail) return "\u2014";
  const kvPattern = /^[\w\u4e00-\u9fa5]+=[^=]*(&[\w\u4e00-\u9fa5]+=[^=]*)*$/;
  if (!kvPattern.test(detail) && !detail.includes("=")) return detail;
  return detail
    .split(/\s+/)
    .filter(Boolean)
    .map((pair) => {
      const eqIdx = pair.indexOf("=");
      if (eqIdx === -1) return pair;
      const key = pair.slice(0, eqIdx);
      const val = pair.slice(eqIdx + 1);
      return val ? `${key}: ${val}` : key;
    })
    .join(" / ");
}

export default function AuditLogs() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 30;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["audit-logs", page, search],
    queryFn: () =>
      apiRequest<{ logs: AuditEntry[]; total: number }>(
        "GET",
        `/audit/logs?limit=${pageSize}&offset=${page * pageSize}${search ? "&search=" + encodeURIComponent(search) : ""}`
      ),
  });

  const logs = data?.logs || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize);

  const formatTime = (t: string) => {
    try {
      return new Date(t).toLocaleString("zh-CN");
    } catch {
      return t;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">平台操作日志</h1>
          <p className="text-sm text-muted-foreground mt-1">管理员操作记录与追踪</p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-2 text-sm border border-border rounded-lg hover:bg-accent"
        >
          <RefreshCw className="w-4 h-4" /> 刷新
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            className="w-full pl-9 pr-3 py-2 text-sm bg-background border border-border rounded-lg"
            placeholder="搜索目标或详情..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          />
        </div>
        <span className="text-xs text-muted-foreground">{total} 条记录</span>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <ClipboardList className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">暂无审计记录</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">时间</th>
                <th className="px-4 py-3 font-medium">操作者</th>
                <th className="px-4 py-3 font-medium">操作</th>
                <th className="px-4 py-3 font-medium">目标</th>
                <th className="px-4 py-3 font-medium">详情</th>
                <th className="px-4 py-3 font-medium">来源 IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-accent/30 transition-colors">
                  <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{formatTime(l.created_at)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <User className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs">{l.username || "-"}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${actionColors[l.action] || "bg-zinc-500/10 text-zinc-400"}`}>
                      {actionLabels[l.action] || l.action}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs max-w-36 truncate" title={l.target}>{formatTarget(l.action, l.target)}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-52 truncate" title={l.detail}>{formatDetail(l.detail)}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">{l.source_ip || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-accent disabled:opacity-30"
          >
            上一页
          </button>
          <span className="text-xs text-muted-foreground">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-accent disabled:opacity-30"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
