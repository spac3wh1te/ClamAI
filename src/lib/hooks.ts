import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";

// 通用类型定义
export interface Provider {
  id: string;
  name: string;
  provider_type: string;
  enabled: boolean;
  base_url: string;
  models: string[];
  priority: number;
}

export interface OAuthConfig {
  provider_type: string;
  client_id?: string;
  redirect_uri?: string;
  tokens?: {
    access_token: string;
    expires_at: string;
  };
}

// 提供商管理Hook
export function useProviders() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = async () => {
    try {
      setIsLoading(true);
      const data = await invoke<Provider[]>("get_providers");
      setProviders(data);
    } catch (err) {
      setError(err as string);
    } finally {
      setIsLoading(false);
    }
  };

  const addProvider = async (provider: Provider) => {
    await invoke("add_provider", { provider });
    await loadProviders();
  };

  const removeProvider = async (id: string) => {
    await invoke("remove_provider", { id });
    await loadProviders();
  };

  const updateProvider = async (provider: Provider) => {
    await invoke("update_provider", { provider });
    await loadProviders();
  };

  const testProvider = async (providerId: string) => {
    return await invoke("test_provider", { providerId });
  };

  return {
    providers,
    isLoading,
    error,
    addProvider,
    removeProvider,
    updateProvider,
    testProvider,
    refresh: loadProviders,
  };
}

// 配置管理Hook
export function useConfig() {
  const [config, setConfig] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      setIsLoading(true);
      const data = await invoke("get_config");
      setConfig(data);
    } catch (err) {
      console.error("Failed to load config:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const saveConfig = async (newConfig: any) => {
    await invoke("save_config", { config: newConfig });
    await loadConfig();
  };

  const resetConfig = async () => {
    await invoke("reset_config");
    await loadConfig();
  };

  return {
    config,
    isLoading,
    saveConfig,
    resetConfig,
    refresh: loadConfig,
  };
}

// 代理服务状态Hook
export function useProxyStatus() {
  const [status, setStatus] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadStatus();

    // 每5秒刷新一次状态
    const interval = setInterval(loadStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadStatus = async () => {
    try {
      const data = await invoke("get_proxy_status");
      setStatus(data);
    } catch (err) {
      console.error("Failed to load proxy status:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const startProxy = async () => {
    await invoke("start_proxy_service");
    await loadStatus();
  };

  const stopProxy = async () => {
    await invoke("stop_proxy_service");
    await loadStatus();
  };

  const restartProxy = async () => {
    await invoke("restart_proxy_service");
    await loadStatus();
  };

  return {
    status,
    isLoading,
    startProxy,
    stopProxy,
    restartProxy,
    refresh: loadStatus,
  };
}

// 统计数据Hook
export function useUsageStats(days: number = 7) {
  const [stats, setStats] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, [days]);

  const loadStats = async () => {
    try {
      setIsLoading(true);
      const data = await invoke("get_usage_stats", { days });
      setStats(data);
    } catch (err) {
      console.error("Failed to load usage stats:", err);
    } finally {
      setIsLoading(false);
    }
  };

  return {
    stats,
    isLoading,
    refresh: loadStats,
  };
}

// 请求日志Hook
export function useRequestLogs(limit: number = 50, offset: number = 0) {
  const [logs, setLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadLogs();
  }, [limit, offset]);

  const loadLogs = async () => {
    try {
      setIsLoading(true);
      const data = await invoke<any[]>("get_request_logs", { limit, offset });
      setLogs(data);
    } catch (err) {
      console.error("Failed to load request logs:", err);
    } finally {
      setIsLoading(false);
    }
  };

  return {
    logs,
    isLoading,
    refresh: loadLogs,
  };
}

export function formatDate(date: string | Date, timezone?: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  };
  if (timezone) {
    return d.toLocaleString("zh-CN", { ...options, timeZone: timezone });
  }
  return d.toLocaleString("zh-CN", options);
}

export function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(2)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(2)}K`;
  }
  return num.toString();
}

export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function formatLatency(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

export function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

// 错误处理
export function handleError(
  error: any,
  defaultMessage: string = "操作失败",
): string {
  if (typeof error === "string") {
    return error;
  }
  if (error?.message) {
    return error.message;
  }
  return defaultMessage;
}

// 本地存储
export function storage() {
  return {
    get: (key: string) => {
      try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : null;
      } catch {
        return null;
      }
    },
    set: (key: string, value: any) => {
      localStorage.setItem(key, JSON.stringify(value));
    },
    remove: (key: string) => {
      localStorage.removeItem(key);
    },
    clear: () => {
      localStorage.clear();
    },
  };
}
