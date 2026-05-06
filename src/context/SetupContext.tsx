import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { configApi } from "../api/config";
import { authApi } from "../api/auth";

interface SetupContextType {
  setupComplete: boolean;
  setupChecked: boolean;
  deployMode: string;
  serviceUrl: string;
  connected: boolean;
  checkSetup: () => Promise<void>;
  reconnect: (username?: string, password?: string) => Promise<void>;
}

const SetupContext = createContext<SetupContextType | null>(null);

export function SetupProvider({ children }: { children: React.ReactNode }) {
  const [setupComplete, setSetupComplete] = useState(false);
  const [setupChecked, setSetupChecked] = useState(false);
  const [deployMode, setDeployMode] = useState("pc");
  const [serviceUrl, setServiceUrl] = useState("");
  const [connected, setConnected] = useState(false);

  const checkSetup = useCallback(async () => {
    try {
      console.log("[SetupContext] checkSetup() called");
      const status = await authApi.status();
      const isInitialized = status.initialized === true;
      const mode = status.mode || "pc";
      setDeployMode(mode);
      setConnected(true);

      if (isInitialized) {
        try {
          const config = await configApi.get();
          setSetupComplete(config.service.setup_complete);
          setServiceUrl(config.service.remote_service_url || "");
        } catch {
          setSetupComplete(true);
        }
      } else {
        setSetupComplete(false);
      }
    } catch (e) {
      console.error("[SetupContext] checkSetup FAILED:", e);
      setConnected(false);
      setSetupComplete(false);
    } finally {
      setSetupChecked(true);
    }
  }, []);

  const reconnect = useCallback(
    async (username?: string, password?: string) => {
      console.log(`[SetupContext] reconnect() mode=${deployMode}`);
      if (deployMode === "pc") {
        try {
          const token = await authApi.tryAutoLogin();
          if (token) {
            setConnected(true);
            return;
          }
        } catch {}
        try {
          await invoke("start_proxy_service");
          await new Promise((r) => setTimeout(r, 3000));
          const token = await authApi.tryAutoLogin();
          if (token) {
            setConnected(true);
            return;
          }
        } catch (e: any) {
          throw new Error(e?.toString?.() || "启动服务失败");
        }
      } else {
        if (!username || !password) {
          throw new Error("请输入用户名和密码");
        }
        const { handleLoginResult } = await import("../api/auth");
        const result = await authApi.login(username, password);
        handleLoginResult(result);
        setConnected(true);
      }
    },
    [deployMode],
  );

  useEffect(() => {
    checkSetup();
  }, [checkSetup]);

  return (
    <SetupContext.Provider
      value={{
        setupComplete,
        setupChecked,
        deployMode,
        serviceUrl,
        connected,
        checkSetup,
        reconnect,
      }}
    >
      {children}
    </SetupContext.Provider>
  );
}

export function useSetup() {
  const context = useContext(SetupContext);
  if (!context) {
    throw new Error("useSetup must be used within SetupProvider");
  }
  return context;
}
