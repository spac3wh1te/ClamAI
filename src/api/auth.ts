import { apiRequest, setTokens, clearTokens, getToken } from "./client";

export interface AuthStatus {
  initialized: boolean;
  mode: string;
  has_api_key: boolean;
  registration_open: boolean;
}

export interface LoginResult {
  access_token: string;
  refresh_token?: string;
  expires_at?: string;
  user?: { id: string; username: string; role: string };
}

export interface UserInfo {
  id: string;
  username: string;
  role: string;
  display_name?: string;
}

export const authApi = {
  status: () => {
    console.log("[AUTH] status()");
    return apiRequest<AuthStatus>("GET", "/auth/status", undefined, { noAuth: true });
  },

  setup: (username: string, password: string, baseUrl?: string) => {
    console.log(`[AUTH] setup(${username})`);
    return apiRequest<LoginResult>("POST", "/auth/setup", { username, password }, { noAuth: true, baseUrl });
  },

  login: (username: string, password: string) => {
    console.log(`[AUTH] login(${username})`);
    return apiRequest<LoginResult>("POST", "/auth/login", { username, password }, { noAuth: true });
  },

  register: (username: string, password: string, displayName?: string) => {
    console.log(`[AUTH] register(${username})`);
    return apiRequest<LoginResult>("POST", "/auth/register", { username, password, display_name: displayName }, { noAuth: true });
  },

  me: () => {
    console.log("[AUTH] me()");
    return apiRequest<UserInfo>("GET", "/auth/me");
  },

  changePassword: (oldPassword: string, newPassword: string) => {
    console.log("[AUTH] changePassword()");
    return apiRequest<void>("POST", "/auth/change-password", { old_password: oldPassword, new_password: newPassword });
  },

  logout: () => {
    console.log("[AUTH] logout()");
    clearTokens();
    return apiRequest<void>("POST", "/auth/logout").catch(() => {});
  },

  tryAutoLogin: async (): Promise<string | null> => {
    console.log("[AUTH] tryAutoLogin()");
    try {
      const result = await apiRequest<{ access_token: string }>("POST", "/auth/token", { password: "" }, { noAuth: true });
      console.log("[AUTH] tryAutoLogin success");
      return result.access_token || null;
    } catch (e) {
      console.log("[AUTH] tryAutoLogin failed:", e);
      return null;
    }
  },
};

export function handleLoginResult(result: LoginResult): string {
  const token = result.access_token;
  setTokens(token, result.refresh_token);
  return token;
}
