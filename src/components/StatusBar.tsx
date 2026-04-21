import React, { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/tauri'
import { Activity, Zap, Server } from 'lucide-react'

interface ServiceStatus {
  proxy_running: boolean
  proxy_port: number
  uptime_seconds: number
  active_connections: number
  total_requests: number
}

export default function StatusBar() {
  const { data: status } = useQuery({
    queryKey: ['proxy-status'],
    queryFn: () => invoke<ServiceStatus>('get_proxy_status'),
    refetchInterval: 5000,
  })

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    if (hours > 0) {
      return `${hours}h ${minutes}m`
    }
    return `${minutes}m`
  }

  return (
    <div className="fixed bottom-0 right-0 left-64 bg-card border-t border-border px-4 py-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-6">
          {/* 代理状态 */}
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4" />
            <span className="text-muted-foreground">代理:</span>
            <span className={`font-medium ${
              status?.proxy_running ? 'text-green-500' : 'text-red-500'
            }`}>
              {status?.proxy_running ? '运行中' : '已停止'}
            </span>
          </div>

          {/* 端口信息 */}
          {status?.proxy_running && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">端口:</span>
              <span className="font-medium">{status.proxy_port}</span>
            </div>
          )}

          {/* 运行时间 */}
          {status?.proxy_running && status.uptime_seconds > 0 && (
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4" />
              <span className="text-muted-foreground">运行时间:</span>
              <span className="font-medium">
                {formatUptime(status.uptime_seconds)}
              </span>
            </div>
          )}

          {/* 活动连接 */}
          {status?.proxy_running && status.active_connections > 0 && (
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4" />
              <span className="text-muted-foreground">活动连接:</span>
              <span className="font-medium">{status.active_connections}</span>
            </div>
          )}
        </div>

        {/* 总请求数 */}
        {status && status.total_requests > 0 && (
          <div className="text-muted-foreground">
            总请求: <span className="font-medium text-foreground">{status.total_requests}</span>
          </div>
        )}
      </div>
    </div>
  )
}
