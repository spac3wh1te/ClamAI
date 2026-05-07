import { apiRequest } from "./client";

export interface ThreatRule {
  id: number;
  threat_type: string;
  name: string;
  patterns: string[];
  severity: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ThreatStats {
  by_type: Record<string, number>;
  total: number;
  rule_counts: { threat_type: string; total: number; enabled: number }[];
}

export const threatApi = {
  listRules: (type?: string) => {
    const qs = type ? `?type=${type}` : "";
    return apiRequest<{ rules: ThreatRule[] }>("GET", `/threats/rules${qs}`);
  },

  createRule: (rule: { threat_type: string; name: string; patterns: string[]; severity: string; enabled: boolean }) =>
    apiRequest<{ id: number; success: boolean }>("POST", "/threats/rules", rule),

  updateRule: (id: number, rule: { threat_type: string; name: string; patterns: string[]; severity: string; enabled: boolean }) =>
    apiRequest<{ success: boolean }>("PUT", `/threats/rules/${id}`, rule),

  deleteRule: (id: number) =>
    apiRequest<{ success: boolean }>("DELETE", `/threats/rules/${id}`),

  stats: (period?: number) =>
    apiRequest<ThreatStats>("GET", `/threats/stats${period ? `?period=${period}` : ""}`),
};
