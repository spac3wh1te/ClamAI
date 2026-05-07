import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/tauri";
import { Activity, Zap, Server, Monitor, Globe } from "lucide-react";
import { useSetup } from "../context/SetupContext";

interface ServiceStatus {
  proxy_running: boolean;
  proxy_port: number;
  admin_port: number;
  uptime_seconds: number;
  active_connections: number;
  total_requests: number;
  deploy_mode: string;
  service_url: string;
}

export default function StatusBar() {
  const { connected, deployMode } = useSetup();

  const { data: status } = useQuery({
    queryKey: ["proxy-status"],
    queryFn: () => invoke<ServiceStatus>("get_proxy_status"),
    refetchInterval: 5000,
  });

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const isRunning = connected;
  const mode = status?.deploy_mode ?? deployMode;

  return (
    <div className="bg-card border-t border-border px-4 py-1.5 shrink-0">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-1.5">
            {mode === "pc" ? (
              <Monitor className="w-3.5 h-3.5 text-muted-foreground" />
            ) : (
              <Globe className="w-3.5 h-3.5 text-muted-foreground" />
            )}
            <span className="text-muted-foreground">模式:</span>
            <span className="font-medium text-foreground">{mode === "pc" ? "PC本地" : "服务器"}</span>
          </div>

          <div className="flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">代理:</span>
            <span className={`font-medium ${isRunning ? "text-emerald-400" : "text-red-400"}`}>
              {isRunning ? "已连接" : "未连接"}
            </span>
          </div>

          {status && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">端口:</span>
              <span className="font-mono text-foreground">:{status.proxy_port}</span>
            </div>
          )}

          {isRunning && status?.uptime_seconds && status.uptime_seconds > 0 && (
            <div className="flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">运行:</span>
              <span className="font-medium text-foreground">{formatUptime(status.uptime_seconds)}</span>
            </div>
          )}

          {isRunning && status?.active_connections && status.active_connections > 0 && (
            <div className="flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">连接:</span>
              <span className="font-medium text-foreground">{status.active_connections}</span>
            </div>
          )}
        </div>

        {status && status.total_requests > 0 && (
          <div className="text-muted-foreground">
            总请求: <span className="font-medium text-foreground">{status.total_requests}</span>
          </div>
        )}
      </div>
    </div>
  );
}
