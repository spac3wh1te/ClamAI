import { apiRequest } from "./client";

export interface RateLimitConfig {
  global_rpm: number;
  key_rpm: number;
  model_rpm: Record<string, number>;
  provider_rpm: Record<string, number>;
}

export const rateLimitApi = {
  get: () => apiRequest<RateLimitConfig>("GET", "/ratelimit/config"),

  save: (config: RateLimitConfig) =>
    apiRequest<void>("PUT", "/ratelimit/config", config),
};
