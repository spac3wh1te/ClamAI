import { apiRequest, getAdminBaseUrl, getProxyBaseUrl, getToken, rawFetch } from "./client";

export interface UsageStats {
  total_requests: number;
  success_requests: number;
  error_requests: number;
  input_tokens: number;
  output_tokens: number;
  total_latency_ms: number;
  requests_by_provider: Record<string, number>;
  requests_by_model: Record<string, number>;
  tokens_by_provider: Record<string, { input_tokens: number; output_tokens: number }>;
  tokens_by_model: Record<string, { input_tokens: number; output_tokens: number }>;
  daily_stats: Record<string, { requests: number; input_tokens: number; output_tokens: number }>;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  status: number;
  latency_ms: number;
  provider: string;
  model: string;
  caller: string;
  input_tokens: number;
  output_tokens: number;
  error: string;
  request_body: string;
  response_body: string;
}

export interface AlertStats {
  total: number;
  by_severity: Record<string, number>;
  by_type: Record<string, number>;
  recent: any[];
}

export interface CallerTop10 {
  callers: { caller: string; count: number; tokens: number }[];
}

export interface SecurityTokenStats {
  total_input_tokens: number;
  total_output_tokens: number;
  by_caller: Record<string, number>;
}

export interface DashboardData {
  total_requests: number;
  active_providers: number;
  total_api_keys: number;
  recent_errors: number;
  uptime_seconds: number;
}

export const statsApi = {
  usage: (period: number = 7) =>
    apiRequest<UsageStats>("GET", `/stats/usage?period=${period}`),

  logs: (params?: { page?: number; limit?: number; level?: string }) => {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", String(params.page));
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.level) query.set("level", params.level);
    const qs = query.toString();
    return apiRequest<{ logs: LogEntry[]; total: number }>("GET", `/stats/logs${qs ? "?" + qs : ""}`);
  },

  alerts: () => apiRequest<AlertStats>("GET", "/stats/alerts"),

  callerTop10: () => apiRequest<CallerTop10>("GET", "/stats/callers"),

  securityTokenStats: () => apiRequest<SecurityTokenStats>("GET", "/stats/security-tokens"),

  dashboard: () => apiRequest<DashboardData>("GET", "/stats/dashboard"),

  exportLogs: async (): Promise<string> => {
    const base = await getAdminBaseUrl();
    const token = getToken();
    const resp = await fetch(`${base}/api/v1/stats/logs/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error("导出失败");
    return resp.text();
  },

  serviceLogs: async (params?: { level?: string; keyword?: string; limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params?.level) query.set("level", params.level);
    if (params?.keyword) query.set("keyword", params.keyword);
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.offset) query.set("offset", String(params.offset));
    const qs = query.toString();
    return apiRequest<{ lines: string[]; total: number }>("GET", `/stats/service-logs${qs ? "?" + qs : ""}`);
  },
};

export interface ProxyModelsResult {
  models: string[];
}

export interface TestChatResult {
  success: boolean;
  message: string;
  response?: any;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
}

export interface ProxyTestResult {
  success: boolean;
  message: string;
  latency_ms?: number;
}

export const proxyApi = {
  getModels: async (): Promise<string[]> => {
    const base = await getProxyBaseUrl();
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const resp = await rawFetch("GET", `${base}/v1/models`, headers);
    if (resp.status < 200 || resp.status >= 300) return [];
    const data = JSON.parse(resp.body);
    return (data.data || []).map((m: any) => m.id);
  },

  testChat: async (params: {
    mode: "direct" | "proxy";
    baseUrl?: string;
    apiKey?: string;
    model: string;
    message: string;
    providerType?: string;
    providerId?: string;
  }): Promise<TestChatResult> => {
    return apiRequest<TestChatResult>("POST", "/proxy/test-chat", params);
  },

  testConnectivity: async (proxyUrl?: string): Promise<ProxyTestResult> => {
    const base = await getAdminBaseUrl();
    const token = getToken();
    const url = proxyUrl
      ? `${base}/api/v1/proxy/test?url=${encodeURIComponent(proxyUrl)}`
      : `${base}/api/v1/proxy/test`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error("代理测试失败");
    return resp.json();
  },
};
