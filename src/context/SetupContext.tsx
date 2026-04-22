import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { invoke } from "@tauri-apps/api/tauri";

interface SetupContextType {
  setupComplete: boolean;
  setupChecked: boolean;
  deployMode: string;
  serviceUrl: string;
  connected: boolean;
  checkSetup: () => Promise<void>;
  reconnect: (username?: string, password?: string) => Promise<void>;
}

interface SetupState {
  setup_complete: boolean;
  deploy_mode: string;
  service_url: string;
  connected: boolean;
}

interface ConnectivityResult {
  success: boolean;
  message: string;
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
      const state = await invoke<SetupState>("get_setup_state");
      setSetupComplete(state.setup_complete);
      setDeployMode(state.deploy_mode);
      setServiceUrl(state.service_url);

      if (state.setup_complete && state.service_url) {
        try {
          const result = await invoke<ConnectivityResult>(
            "check_service_connection",
            { serviceUrl: state.service_url },
          );
          setConnected(result.success);
        } catch {
          setConnected(false);
        }
      } else {
        setConnected(false);
      }
    } catch (e) {
      console.error("Failed to check setup state:", e);
      setConnected(false);
      setSetupComplete(false);
    } finally {
      setSetupChecked(true);
    }
  }, []);

  const reconnect = useCallback(
    async (username?: string, password?: string) => {
      await invoke("connect_service");
      await new Promise((r) => setTimeout(r, 3000));

      if (deployMode === "pc") {
        try {
          const data = await invoke<string>("get_admin_token", {
            password: "",
          });
          const result = JSON.parse(data);
          if (result.success && result.token) {
            localStorage.setItem("clamai_token", result.token);
            setConnected(true);
            return;
          }
        } catch {}
      }

      if (!username || !password) {
        throw new Error("请输入用户名和密码");
      }
      const data = await invoke<string>("login_admin", { username, password });
      const result = JSON.parse(data);
      if (!result.success) {
        throw new Error(result.error || "认证失败");
      }
      localStorage.setItem("clamai_token", result.token);
      setConnected(true);
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
