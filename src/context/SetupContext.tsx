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
}

interface SetupState {
  setup_complete: boolean;
  deploy_mode: string;
  service_url: string;
  connected: boolean;
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
      setConnected(state.connected);
    } catch (e) {
      console.error("Failed to check setup state:", e);
      setSetupComplete(false);
    } finally {
      setSetupChecked(true);
    }
  }, []);

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
