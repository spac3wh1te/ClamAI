import { Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Component, type ReactNode, useCallback, useEffect } from "react";

import Dashboard from "./pages/Dashboard";
import Providers from "./pages/Providers";
import Models from "./pages/Models";
import ApiKeys from "./pages/ApiKeys";
import Settings from "./pages/Settings";
import Logs from "./pages/Logs";
import Security from "./pages/Security";
import SecuritySquare from "./pages/SecuritySquare";
import RateLimit from "./pages/RateLimit";
import Login from "./pages/Login";
import SetupWizard from "./pages/SetupWizard";

import Layout from "./components/Layout";
import StatusBar from "./components/StatusBar";
import ConnectBanner from "./components/ConnectBanner";
import { ApiKeySecretsProvider } from "./context/ApiKeySecretsContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { AppProvider } from "./context/AppContext";
import { SetupProvider, useSetup } from "./context/SetupContext";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      retry: 1,
    },
  },
});

const mainRoutes = (
  <Routes>
    <Route path="/" element={<Dashboard />} />
    <Route path="/providers" element={<Providers />} />
    <Route path="/models" element={<Models />} />
    <Route path="/api-keys" element={<ApiKeys />} />
    <Route path="/settings" element={<Settings />} />
    <Route path="/logs" element={<Logs />} />
    <Route path="/security" element={<Security />} />
    <Route path="/security-square" element={<SecuritySquare />} />
    <Route path="/rate-limit" element={<RateLimit />} />
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
            <h1 className="text-2xl font-bold text-destructive mb-4">
              Something went wrong
            </h1>
            <p className="text-muted-foreground mb-4 text-sm font-mono break-all">
              {this.state.error?.message}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AuthExpiredGuard({ children }: { children: ReactNode }) {
  const { handleAuthExpired } = useAuth();

  const interceptor = useCallback(
    (error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("AUTH_EXPIRED")) {
        handleAuthExpired();
      }
    },
    [handleAuthExpired],
  );

  useEffect(() => {
    const originalQueryFn = queryClient.getDefaultOptions().queries?.retry;
    const unsub = queryClient.getQueryCache().subscribe((event) => {
      if (event?.type === "observerResultsUpdated") return;
    });

    queryClient.getQueryCache().config.onError = (error) => {
      interceptor(error);
    };
    queryClient.getMutationCache().config.onError = (error) => {
      interceptor(error);
    };

    return unsub;
  }, [interceptor]);

  return <>{children}</>;
}

function AppContent() {
  const { isAuthenticated, isInitialized, initialized } = useAuth();
  const { setupComplete, setupChecked, connected, checkSetup } = useSetup();

  if (!isInitialized || !setupChecked) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!setupComplete) {
    return <SetupWizard onComplete={checkSetup} />;
  }

  if (connected && (!initialized || !isAuthenticated)) {
    return <Login />;
  }

  return (
    <ApiKeySecretsProvider>
      <div className="min-h-screen bg-background text-foreground">
        {!connected && <ConnectBanner />}
        <Layout>{mainRoutes}</Layout>
        <StatusBar />
      </div>
    </ApiKeySecretsProvider>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AppProvider>
            <SetupProvider>
              <AuthExpiredGuard>
                <AppContent />
              </AuthExpiredGuard>
            </SetupProvider>
          </AppProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
