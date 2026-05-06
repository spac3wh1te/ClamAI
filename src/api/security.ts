import { apiRequest, getAdminBaseUrl } from "./client";

export interface SecurityConfig {
  enabled: boolean;
  sensitivity: string;
  custom_keywords: string[];
  blocked_categories: string[];
}

export interface SecurityLog {
  id: string;
  timestamp: string;
  type: string;
  severity: string;
  message: string;
  details: any;
}

export interface SecurityStats {
  total_checks: number;
  blocked: number;
  allowed: number;
  by_type: Record<string, number>;
}

export const securityApi = {
  getConfig: () => apiRequest<SecurityConfig>("GET", "/security/config"),

  saveConfig: (config: SecurityConfig) =>
    apiRequest<void>("PUT", "/security/config", config),

  getLogs: (params?: { page?: number; limit?: number; type?: string }) => {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", String(params.page));
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.type) query.set("type", params.type);
    const qs = query.toString();
    return apiRequest<{ alerts: SecurityLog[]; total: number }>("GET", `/security/alerts${qs ? "?" + qs : ""}`);
  },

  checkContent: (content: string, caller?: string) =>
    apiRequest<{ safe: boolean; issues: any[] }>("POST", "/security/check", { content, caller }),
};
