import { apiRequest, setAdminBaseUrl, clearCachedUrls, isTauri } from "./client";
import { authApi, handleLoginResult } from "./auth";

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  initialized?: boolean;
}

export interface CompleteSetupParams {
  deploy_mode: string;
  port: number | null;
  admin_port: number | null;
  use_tls: boolean;
  host: string;
  remote_url: string | null;
  remote_proxy_url: string | null;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/tauri");
  return tauriInvoke<T>(cmd, args);
}

async function checkPortTauri(port: number): Promise<boolean> {
  return invoke<boolean>("check_port_available", { port });
}

async function checkConnectionHttp(serviceUrl: string): Promise<ConnectionTestResult> {
  try {
    const base = serviceUrl.replace(/\/+$/, "");
    const resp = await fetch(`${base}/health`, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return { success: false, message: `HTTP ${resp.status}` };
    let initialized: boolean | undefined;
    try {
      const statusResp = await fetch(`${base}/api/v1/auth/status`, { signal: AbortSignal.timeout(5000) });
      if (statusResp.ok) {
        const data = await statusResp.json();
        initialized = !!data.initialized;
      }
    } catch {}
    return { success: true, message: "连接成功", initialized };
  } catch (e: any) {
    return { success: false, message: e?.message || "连接失败" };
  }
}

export const setupApi = {
  checkPort: (port: number): Promise<boolean> => {
    if (isTauri()) {
      return checkPortTauri(port);
    }
    return Promise.resolve(true);
  },

  checkConnection: (serviceUrl: string): Promise<ConnectionTestResult> => {
    return checkConnectionHttp(serviceUrl);
  },

  completeSetup: async (params: CompleteSetupParams): Promise<string> => {
    if (!isTauri()) {
      return "";
    }
    await invoke("complete_setup_with_config", {
      deployMode: params.deploy_mode,
      port: params.port,
      adminPort: params.admin_port,
      useTls: params.use_tls,
      host: params.host,
      remoteUrl: params.remote_url,
      remoteProxyUrl: params.remote_proxy_url,
    });
    clearCachedUrls();
    const adminPort = params.admin_port ?? (params.port ? params.port + 1 : 8081);
    const adminUrl = `http://localhost:${adminPort}`;
    setAdminBaseUrl(adminUrl);
    return adminUrl;
  },

  setupAdmin: async (username: string, password: string, adminBaseUrl?: string): Promise<void> => {
    const result = await authApi.setup(username, password, adminBaseUrl);
    if (result.access_token) {
      handleLoginResult(result);
    }
  },

  initRemote: async (username: string, password: string, remoteUrl: string): Promise<void> => {
    const base = remoteUrl.replace(/\/+$/, "");
    const resp = await fetch(`${base}/api/v1/auth/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.message || `初始化失败: HTTP ${resp.status}`);
    }
    const result = await resp.json();
    if (result.access_token) {
      handleLoginResult(result);
    }
  },
};
