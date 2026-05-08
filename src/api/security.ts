import { apiRequest } from "./client";

export interface DirectionConfig {
  enabled: boolean;
  mode: "block" | "detect";
  keyword_enabled: boolean;
  keyword_categories: string[];
  semantic_enabled: boolean;
  vector_enabled: boolean;
}

export interface SecurityConfig {
  enabled: boolean;
  input: DirectionConfig;
  output: DirectionConfig;
  keywords: string[];
  keyword_by_level: Record<string, string[]>;
  keyword_by_category: Record<string, Record<string, string[]>>;
  keyword_levels: string[];
  block_message: string;
  semantic_model: string;
  semantic_threshold: number;
  semantic_prompt: string;
  auto_ban_key: boolean;
}

export interface SecurityAlert {
  id: number;
  timestamp: string;
  direction: string;
  mode: string;
  trigger_type: string;
  trigger_detail: string;
  severity: string;
  content_preview: string;
  model: string;
  api_key_used: string;
  client_ip: string;
  action: string;
  resolved: number;
}

export interface SecurityStats {
  total: number;
  unresolved: number;
  today: number;
  hour24: number;
}

export interface AlertFilterParams {
  limit?: number;
  offset?: number;
  resolved?: number;
  severity?: string;
  direction?: string;
  trigger_type?: string;
  exclude_trigger_type?: string;
  search?: string;
}

export const securityApi = {
  getConfig: () => apiRequest<SecurityConfig>("GET", "/security/config"),

  saveConfig: (config: SecurityConfig) =>
    apiRequest<void>("PUT", "/security/config", config),

  getLogs: (params?: AlertFilterParams) => {
    const query = new URLSearchParams();
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.offset) query.set("offset", String(params.offset));
    if (params?.resolved !== undefined) query.set("resolved", String(params.resolved));
    if (params?.severity) query.set("severity", params.severity);
    if (params?.direction) query.set("direction", params.direction);
    if (params?.trigger_type) query.set("trigger_type", params.trigger_type);
    if (params?.exclude_trigger_type) query.set("exclude_trigger_type", params.exclude_trigger_type);
    if (params?.search) query.set("search", params.search);
    const qs = query.toString();
    return apiRequest<{ alerts: SecurityAlert[]; total: number }>("GET", `/security/alerts${qs ? "?" + qs : ""}`);
  },

  getStats: (source = "content") => apiRequest<SecurityStats>("GET", `/security/stats?source=${source}`),

  checkContent: (content: string, caller?: string) =>
    apiRequest<{ safe: boolean; issues: any[] }>("POST", "/security/check", { content, caller }),

  toggleAlert: (id: number) =>
    apiRequest<{ success: boolean; resolved: number }>("PUT", `/security/alerts/${id}/resolve`),
};
