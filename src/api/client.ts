const TOKEN_KEY = "clamai_token";
const TOKEN_REFRESH_KEY = "clamai_refresh_token";

let cachedAdminBase: string | null = null;
let cachedProxyBase: string | null = null;

export function isTauri(): boolean {
  const w = window as any;
  return !!(w.__TAURI_IPC__ || w.__TAURI_INTERNALS__);
}

async function getTauriServiceUrl(): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/tauri");
  return invoke<string>("get_service_url");
}

async function getTauriProxyUrl(): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/tauri");
  return invoke<string>("get_proxy_url_cmd");
}

export async function getAdminBaseUrl(): Promise<string> {
  if (cachedAdminBase) return cachedAdminBase;
  if (isTauri()) {
    cachedAdminBase = await getTauriServiceUrl();
  } else {
    cachedAdminBase = window.location.origin;
  }
  return cachedAdminBase;
}

export async function getProxyBaseUrl(): Promise<string> {
  if (cachedProxyBase) return cachedProxyBase;
  if (isTauri()) {
    cachedProxyBase = await getTauriProxyUrl();
  } else {
    const base = await getAdminBaseUrl();
    try {
      const resp = await rawFetch("GET", `${base}/api/v1/app/info`, { "Content-Type": "application/json" }, undefined);
      if (resp.status === 200) {
        const info = JSON.parse(resp.body);
        if (info.proxy_port) {
          const url = new URL(base);
          url.port = String(info.proxy_port);
          cachedProxyBase = url.origin;
          return cachedProxyBase;
        }
      }
    } catch {}
    cachedProxyBase = base;
  }
  return cachedProxyBase;
}

export function clearCachedUrls(): void {
  cachedAdminBase = null;
  cachedProxyBase = null;
}

export function setAdminBaseUrl(url: string): void {
  cachedAdminBase = url;
}

export function setProxyBaseUrl(url: string): void {
  cachedProxyBase = url;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setTokens(access: string, refresh?: string): void {
  localStorage.setItem(TOKEN_KEY, access);
  if (refresh) {
    localStorage.setItem(TOKEN_REFRESH_KEY, refresh);
  }
}

export function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_REFRESH_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

let refreshing: Promise<boolean> | null = null;

async function tryRefreshToken(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const refresh = localStorage.getItem(TOKEN_REFRESH_KEY);
      if (!refresh) return false;
      const base = await getAdminBaseUrl();
      const resp = await rawFetch("POST", `${base}/api/v1/auth/refresh`, {
        "Content-Type": "application/json",
      }, JSON.stringify({ refresh_token: refresh }));
      if (resp.status < 200 || resp.status >= 300) return false;
      const data = JSON.parse(resp.body);
      if (data.access_token) {
        setTokens(data.access_token, data.refresh_token || refresh);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export type RequestOptions = {
  noAuth?: boolean;
  baseUrl?: string;
  rawResponse?: boolean;
};

interface RawResponse {
  status: number;
  body: string;
}

export async function rawFetch(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: string,
): Promise<RawResponse> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/tauri");
    return invoke<RawResponse>("tauri_fetch", {
      method,
      url,
      headers,
      body: body || null,
    });
  }
  const resp = await fetch(url, {
    method,
    headers,
    body,
  });
  return { status: resp.status, body: await resp.text() };
}

export async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  const base = options?.baseUrl || (await getAdminBaseUrl());
  if (!base || (!base.startsWith("http://") && !base.startsWith("https://"))) {
    throw new Error(
      `[API] base URL 无效: "${base}", path="${path}". ` +
      `base 必须以 http:// 或 https:// 开头，否则请求会发送到 tauri:// 协议而无法到达 Go 服务。`
    );
  }
  const url = `${base}/api/v1${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (!options?.noAuth) {
    const token = getToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  const doFetch = async (tokenOverride?: string): Promise<RawResponse> => {
    const h = { ...headers };
    if (tokenOverride) {
      h["Authorization"] = `Bearer ${tokenOverride}`;
    }
    return rawFetch(method, url, h, body !== undefined ? JSON.stringify(body) : undefined);
  };

  let resp = await doFetch();

  if (resp.status === 401 && !options?.noAuth) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      resp = await doFetch(getToken() || undefined);
    } else {
      clearTokens();
      window.dispatchEvent(new CustomEvent("auth:unauthorized"));
      throw new ApiError("认证已过期，请重新登录", 401);
    }
  }

  if (resp.status < 200 || resp.status >= 300) {
    let message = `HTTP ${resp.status}`;
    try {
      const err = JSON.parse(resp.body);
      message = err.message || err.error || err.detail || message;
    } catch {}
    console.error(`[API] ${method} ${url} ERROR ${resp.status}:`, message);
    throw new ApiError(message, resp.status);
  }

  if (options?.rawResponse) {
    return resp as unknown as T;
  }

  const text = resp.body;
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch (parseErr: any) {
    const preview = text.length > 300 ? text.substring(0, 300) + "..." : text;
    throw new Error(
      `[API] ${method} ${url} 返回了非JSON内容 (HTTP ${resp.status}).\n` +
      `响应前300字符: "${preview}"\n` +
      `解析错误: ${parseErr?.message || parseErr}`
    );
  }
}
