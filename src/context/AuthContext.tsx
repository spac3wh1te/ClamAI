import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import { invoke } from "@tauri-apps/api/tauri";

interface AuthContextType {
  token: string | null;
  isAuthenticated: boolean;
  isInitialized: boolean;
  initialized: boolean;
  mode: string;
  serviceReachable: boolean;
  login: (username: string, password: string) => Promise<void>;
  setup: (username: string, password: string) => Promise<void>;
  logout: () => void;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  connectWithAuth: (username: string, password: string) => Promise<void>;
  setServiceReachable: (v: boolean) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem("clamai_token");
  });
  const [isInitialized, setIsInitialized] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [mode, setMode] = useState("pc");
  const [serviceReachable, setServiceReachable] = useState(true);

  useEffect(() => {
    checkStatus();
  }, []);

  useEffect(() => {
    if (token) {
      localStorage.setItem("clamai_token", token);
    } else {
      localStorage.removeItem("clamai_token");
    }
  }, [token]);

  const checkStatus = async () => {
    try {
      const data = await invoke<string>("get_auth_status");
      const status = JSON.parse(data);
      setInitialized(status.initialized);
      setMode(status.mode);
      setIsInitialized(true);
      setServiceReachable(true);

      if (status.mode === "pc" && status.initialized) {
        if (!token) {
          tryAutoLogin();
        }
      }
    } catch (e) {
      console.error("Failed to check auth status:", e);
      setIsInitialized(true);
      setServiceReachable(false);
    }
  };

  const tryAutoLogin = async () => {
    try {
      const data = await invoke<string>("get_admin_token", { password: "" });
      const result = JSON.parse(data);
      if (result.success && result.token) {
        setToken(result.token);
        return;
      }
    } catch (_e) {}
  };

  const login = useCallback(async (username: string, password: string) => {
    const data = await invoke<string>("login_admin", { username, password });
    const result = JSON.parse(data);
    if (result.success && result.token) {
      setToken(result.token);
      setServiceReachable(true);
    } else {
      throw new Error("Login failed");
    }
  }, []);

  const setupAdmin = useCallback(async (username: string, password: string) => {
    const data = await invoke<string>("setup_admin", { username, password });
    const result = JSON.parse(data);
    if (result.success && result.token) {
      setToken(result.token);
      setInitialized(true);
      setServiceReachable(true);
    } else {
      throw new Error("Setup failed");
    }
  }, []);

  const connectWithAuth = useCallback(
    async (username: string, password: string) => {
      await invoke("connect_service");
      await new Promise((r) => setTimeout(r, 2000));
      const data = await invoke<string>("login_admin", { username, password });
      const result = JSON.parse(data);
      if (result.success && result.token) {
        setToken(result.token);
        setServiceReachable(true);
      } else {
        throw new Error("认证失败");
      }
    },
    [],
  );

  const logout = useCallback(() => {
    setToken(null);
    localStorage.removeItem("clamai_token");
  }, []);

  const changePassword = useCallback(
    async (oldPassword: string, newPassword: string) => {
      await invoke("change_admin_password", { oldPassword, newPassword });
    },
    [token],
  );

  return (
    <AuthContext.Provider
      value={{
        token,
        isAuthenticated: !!token,
        isInitialized,
        initialized,
        mode,
        serviceReachable,
        login,
        setup: setupAdmin,
        logout,
        changePassword,
        connectWithAuth,
        setServiceReachable,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
