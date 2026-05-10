import { Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Component, type ReactNode, useCallback, useEffect } from "react";

import Dashboard from "./pages/Dashboard";
import BasicSettings from "./pages/BasicSettings";
import Login from "./pages/Login";
import SetupWizard from "./pages/SetupWizard";

import Layout from "./components/Layout";
import ConnectBanner from "./components/ConnectBanner";
import { ApiKeySecretsProvider } from "./context/ApiKeySecretsContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { UserProvider, useCurrentUser } from "./context/UserContext";
import { AppProvider } from "./context/AppContext";
import { SetupProvider, useSetup } from "./context/SetupContext";
import { ThemeProvider } from "./context/ThemeContext";

import ModelManagement from "./pages/ModelManagement";
import AlertRealtime from "./pages/alerts/Realtime";
import AlertThreats from "./pages/alerts/Threats";
import SecurityTools from "./pages/SecurityTools";
import SecuritySettings from "./pages/SecuritySettings";
import UserManagement from "./pages/UserManagement";
import KeyControl from "./pages/KeyControl";
import RateLimit from "./pages/RateLimit";
import ModelCallLogs from "./pages/ModelCallLogs";
import SystemLogs from "./pages/SystemLogs";
import AgentEnvironment from "./pages/agent/AgentEnvironment";
import AgentRuntimeSecurity from "./pages/agent/AgentRuntimeSecurity";
import AgentLogAudit from "./pages/agent/AgentLogAudit";
import About from "./pages/About";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60 * 5, gcTime: 1000 * 60 * 30, retry: 1 },
  },
});

function AdminRoute({ children }: { children: ReactNode }) {
  const { isAdmin } = useCurrentUser();
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const mainRoutes = (
  <Routes>
    <Route path="/" element={<Dashboard />} />
    <Route path="/models-mgmt" element={<ModelManagement />} />
    <Route path="/alerts/realtime" element={<AdminRoute><AlertRealtime /></AdminRoute>} />
    <Route path="/alerts/threats" element={<AdminRoute><AlertThreats /></AdminRoute>} />
    <Route path="/security-tools" element={<SecurityTools />} />
    <Route path="/user-management" element={<AdminRoute><UserManagement /></AdminRoute>} />
    <Route path="/key-control" element={<AdminRoute><KeyControl /></AdminRoute>} />
    <Route path="/rate-limit" element={<AdminRoute><RateLimit /></AdminRoute>} />
    <Route path="/model-call-logs" element={<AdminRoute><ModelCallLogs /></AdminRoute>} />
    <Route path="/system-logs" element={<AdminRoute><SystemLogs /></AdminRoute>} />
    <Route path="/agent-security/environment" element={<AdminRoute><AgentEnvironment /></AdminRoute>} />
    <Route path="/agent-security/runtime" element={<AdminRoute><AgentRuntimeSecurity /></AdminRoute>} />
    <Route path="/agent-security/logs" element={<AdminRoute><AgentLogAudit /></AdminRoute>} />
    <Route path="/basic-settings" element={<BasicSettings />} />
    <Route path="/security-settings" element={<AdminRoute><SecuritySettings /></AdminRoute>} />
    <Route path="/about" element={<About />} />
    <Route path="/providers" element={<Navigate to="/models-mgmt" replace />} />
    <Route path="/models" element={<Navigate to="/models-mgmt" replace />} />
    <Route path="/api-keys" element={<Navigate to="/models-mgmt" replace />} />
    <Route path="/security" element={<Navigate to="/security-settings" replace />} />
    <Route path="/security-alerts" element={<Navigate to="/alerts/realtime" replace />} />
    <Route path="/security-square" element={<Navigate to="/security-tools" replace />} />
    <Route path="/logs" element={<Navigate to="/model-call-logs" replace />} />
    <Route path="/access-control" element={<Navigate to="/model-call-logs" replace />} />
    <Route path="/settings" element={<Navigate to="/basic-settings" replace />} />
    <Route path="/security-policy" element={<Navigate to="/security-settings" replace />} />
    <Route path="/users" element={<Navigate to="/user-management" replace />} />
  </Routes>
);

class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-8">
          <div className="max-w-md text-center">
            <h1 className="text-2xl font-bold text-destructive mb-4">Something went wrong</h1>
            <p className="text-muted-foreground mb-4 text-sm font-mono break-all">{this.state.error?.message}</p>
            <button onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg">Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AuthExpiredGuard({ children }: { children: ReactNode }) {
  const { handleAuthExpired } = useAuth();
  const interceptor = useCallback((error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("AUTH_EXPIRED")) handleAuthExpired();
  }, [handleAuthExpired]);
  useEffect(() => {
    const unsub = queryClient.getQueryCache().subscribe(() => {});
    queryClient.getQueryCache().config.onError = interceptor;
    queryClient.getMutationCache().config.onError = interceptor;
    return unsub;
  }, [interceptor]);
  return <>{children}</>;
}

function AppContent() {
  const { isAuthenticated, isInitialized, initialized, refreshAuth } = useAuth();
  const { setupComplete, setupChecked, connected, checkSetup, deployMode } = useSetup();
  const handleSetupComplete = async () => { await checkSetup(); await refreshAuth(); };
  if (!isInitialized || !setupChecked) return <div className="min-h-screen bg-background flex items-center justify-center"><div className="text-muted-foreground">Loading...</div></div>;
  if (!setupComplete && deployMode !== "server" && !connected) return <SetupWizard onComplete={handleSetupComplete} />;
  if (connected && (!initialized || !isAuthenticated)) return <Login />;
  if (!connected && !isAuthenticated) return <div className="min-h-screen bg-background text-foreground flex items-center justify-center"><div className="text-center"><p className="text-muted-foreground mb-4">服务未连接</p><button onClick={() => window.location.reload()} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg">重新加载</button></div></div>;
  if (isAuthenticated) return <ApiKeySecretsProvider><div className="min-h-screen bg-background text-foreground">{!connected && <ConnectBanner />}<Layout>{mainRoutes}</Layout></div></ApiKeySecretsProvider>;
  return <Login />;
}

function App() {
  return <ErrorBoundary><QueryClientProvider client={queryClient}><ThemeProvider><AuthProvider><UserProvider><AppProvider><SetupProvider><AuthExpiredGuard><AppContent /></AuthExpiredGuard></SetupProvider></AppProvider></UserProvider></AuthProvider></ThemeProvider></QueryClientProvider></ErrorBoundary>;
}

export default App;
