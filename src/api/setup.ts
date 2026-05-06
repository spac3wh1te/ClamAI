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
  console.log(`[SETUP] checkPortTauri(${port})`);
  return invoke<boolean>("check_port_available", { port });
}

async function checkConnectionHttp(serviceUrl: string): Promise<ConnectionTestResult> {
  console.log(`[SETUP] checkConnectionHttp(${serviceUrl})`);
  try {
    const base = serviceUrl.replace(/\/+$/, "");
    console.log(`[SETUP] fetch ${base}/health`);
    const resp = await fetch(`${base}/health`, { signal: AbortSignal.timeout(8000) });
    console.log(`[SETUP] health resp status: ${resp.status}`);
    if (!resp.ok) return { success: false, message: `HTTP ${resp.status}` };
    let initialized: boolean | undefined;
    try {
      console.log(`[SETUP] fetch ${base}/api/v1/auth/status`);
      const statusResp = await fetch(`${base}/api/v1/auth/status`, { signal: AbortSignal.timeout(5000) });
      console.log(`[SETUP] auth/status resp status: ${statusResp.status}`);
      if (statusResp.ok) {
        const data = await statusResp.json();
        initialized = !!data.initialized;
        console.log(`[SETUP] initialized=${initialized}`);
      }
    } catch (e) { console.warn(`[SETUP] auth/status failed:`, e); }
    return { success: true, message: "连接成功", initialized };
  } catch (e: any) {
    console.error(`[SETUP] checkConnectionHttp failed:`, e);
    return { success: false, message: e?.message || "连接失败" };
  }
}

export const setupApi = {
  checkPort: (port: number): Promise<boolean> => {
    console.log(`[SETUP] checkPort(${port})`);
    if (isTauri()) {
      return checkPortTauri(port);
    }
    return Promise.resolve(true);
  },

  checkConnection: (serviceUrl: string): Promise<ConnectionTestResult> => {
    console.log(`[SETUP] checkConnection(${serviceUrl})`);
    return checkConnectionHttp(serviceUrl);
  },

  completeSetup: async (params: CompleteSetupParams): Promise<string> => {
    console.log(`[SETUP] completeSetup:`, JSON.stringify(params));
    if (!isTauri()) {
      console.log(`[SETUP] not in Tauri, skipping`);
      return "";
    }
    console.log(`[SETUP] invoking complete_setup_with_config (args use snake_case)`);
    await invoke("complete_setup_with_config", {
      deployMode: params.deploy_mode,
      port: params.port,
      adminPort: params.admin_port,
      useTls: params.use_tls,
      host: params.host,
      remoteUrl: params.remote_url,
      remoteProxyUrl: params.remote_proxy_url,
    });
    console.log(`[SETUP] invoke complete_setup_with_config returned OK`);
    clearCachedUrls();
    const adminPort = params.admin_port ?? (params.port ? params.port + 1 : 8081);
    const adminUrl = `http://localhost:${adminPort}`;
    setAdminBaseUrl(adminUrl);
    console.log(`[SETUP] completeSetup done, adminBaseUrl set to: ${adminUrl}`);
    return adminUrl;
  },

  setupAdmin: async (username: string, password: string, adminBaseUrl?: string): Promise<void> => {
    console.log(`[SETUP] setupAdmin(${username}) baseUrl=${adminBaseUrl || "(from cache)"}`);
    const result = await authApi.setup(username, password, adminBaseUrl);
    console.log(`[SETUP] setupAdmin result:`, JSON.stringify(result));
    if (result.access_token) {
      handleLoginResult(result);
    }
  },

  initRemote: async (username: string, password: string, remoteUrl: string): Promise<void> => {
    console.log(`[SETUP] initRemote(${username}, ${remoteUrl})`);
    const base = remoteUrl.replace(/\/+$/, "");
    const resp = await fetch(`${base}/api/v1/auth/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    console.log(`[SETUP] initRemote resp status: ${resp.status}`);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.error(`[SETUP] initRemote error:`, err);
      throw new Error(err.message || `初始化失败: HTTP ${resp.status}`);
    }
    const result = await resp.json();
    console.log(`[SETUP] initRemote result:`, JSON.stringify(result));
    if (result.access_token) {
      handleLoginResult(result);
    }
  },
};
