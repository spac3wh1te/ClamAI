import { apiRequest } from "./client";

export interface ProviderApiKey {
  id: string;
  key_value: string;
  name: string;
  is_active: boolean;
  created_at: string;
  last_used: string | null;
  usage_count: number;
}

export interface ProviderConfig {
  id: string;
  name: string;
  provider_type: string;
  auth_type: "apikey" | "oauth";
  enabled: boolean;
  base_url: string;
  api_keys: ProviderApiKey[];
  models: string[];
  disabled_models: string[];
  oauth_config: any;
  rate_limits: any;
  priority: number;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface TestProviderResult {
  success: boolean;
  message: string;
  latency_ms: number;
  available_models: string[];
}

export interface ProviderListResult {
  providers: ProviderConfig[];
}

export const providersApi = {
  list: async (): Promise<ProviderConfig[]> => {
    try {
      const result = await apiRequest<ProviderListResult>("GET", "/providers");
      return result.providers || [];
    } catch {
      return [];
    }
  },

  add: (provider: ProviderConfig) =>
    apiRequest<void>("POST", "/providers", provider),

  update: (id: string, provider: ProviderConfig) =>
    apiRequest<void>("PUT", `/providers/${id}`, provider),

  remove: (id: string) =>
    apiRequest<void>("DELETE", `/providers/${id}`),

  syncKey: (providerName: string, apiKey: string) =>
    apiRequest<void>("PUT", `/providers/${providerName}/key`, { api_key: apiKey }),

  test: (providerId: string) =>
    apiRequest<TestProviderResult>("POST", "/providers/test", { provider_id: providerId }),

  fetchModels: (providerId: string) =>
    apiRequest<{ models: string[] }>("POST", "/providers/test", { provider_id: providerId, fetch_models_only: true }),

  syncAll: () =>
    apiRequest<{ synced: number; total_providers: number }>("POST", "/providers/sync-all"),
};
