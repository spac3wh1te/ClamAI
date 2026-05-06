import { apiRequest } from "./client";

export interface AppConfig {
  version: string;
  gateway: {
    port: number;
    admin_port: number;
    use_tls: boolean;
    host: string;
    api_key: string;
    log_level: string;
  };
  ui: {
    theme: string;
    language: string;
    timezone: string;
    auto_start: boolean;
    minimize_to_tray: boolean;
    show_notifications: boolean;
  };
  advanced: {
    proxy_url: string | null;
  };
  service: {
    deploy_mode: string;
    setup_complete: boolean;
    remote_service_url: string | null;
    remote_proxy_url: string | null;
  };
  active_profile: string;
}

export interface ProfileInfo {
  id: string;
  name: string;
  active: boolean;
}

export interface AppInfo {
  version: string;
  build_mode: string;
  deploy_mode: string;
  proxy_port: number;
  admin_port: number;
}

export const configApi = {
  get: () => apiRequest<AppConfig>("GET", "/config"),

  save: (config: AppConfig) =>
    apiRequest<void>("PUT", "/config", config),

  reset: () =>
    apiRequest<void>("POST", "/config/reset"),

  listProfiles: async (): Promise<ProfileInfo[]> => {
    try {
      const result = await apiRequest<{ profiles: ProfileInfo[] }>("GET", "/profiles");
      return result.profiles || [];
    } catch {
      return [];
    }
  },

  saveAsProfile: (profileId: string, displayName: string) =>
    apiRequest<void>("POST", "/profiles", { profile_id: profileId, display_name: displayName }),

  loadProfile: (profileId: string) =>
    apiRequest<void>("PUT", `/profiles/${encodeURIComponent(profileId)}`, { action: "load" }),

  deleteProfile: (profileId: string) =>
    apiRequest<void>("DELETE", `/profiles/${encodeURIComponent(profileId)}`),

  renameProfile: (profileId: string, newName: string) =>
    apiRequest<void>("PUT", `/profiles/${encodeURIComponent(profileId)}`, { action: "rename", new_name: newName }),

  appInfo: () => apiRequest<AppInfo>("GET", "/app/info"),
};
