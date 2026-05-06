import { apiRequest } from "./client";

export interface ApiKeyInfo {
  id: string;
  key?: string;
  key_preview?: string;
  name: string;
  active: boolean;
  request_count: number;
  last_used: string | null;
  created_at: string;
  allowed_models: string[];
}

export interface ApiKeyListResult {
  keys: ApiKeyInfo[];
}

export interface CreateKeyResult {
  id: string;
  key: string;
}

export interface RevealKeyResult {
  id: string;
  key: string;
}

export const keysApi = {
  list: () => apiRequest<ApiKeyListResult>("GET", "/keys"),

  create: (name: string, allowedModels: string[] = []) =>
    apiRequest<CreateKeyResult>("POST", "/keys", { name, allowed_models: allowedModels }),

  update: (id: string, allowedModels: string[]) =>
    apiRequest<void>("PUT", `/keys/${id}`, { allowed_models: allowedModels }),

  delete: (id: string) =>
    apiRequest<void>("DELETE", `/keys/${id}`),

  reveal: (id: string) =>
    apiRequest<RevealKeyResult>("GET", `/keys/${id}/reveal`),
};
