import { Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
import { ApiKeySecretsProvider } from "./context/ApiKeySecretsContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { AppProvider } from "./context/AppContext";
import { SetupProvider, useSetup } from "./context/SetupContext";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
    },
  },
});

function AppContent() {
  const { isAuthenticated, isInitialized, initialized } = useAuth();
  const { setupComplete, setupChecked, checkSetup } = useSetup();

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

  if (!initialized || !isAuthenticated) {
    return <Login />;
  }

  return (
    <ApiKeySecretsProvider>
      <div className="min-h-screen bg-background text-foreground">
        <Layout>
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
        </Layout>
        <StatusBar />
      </div>
    </ApiKeySecretsProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppProvider>
          <SetupProvider>
            <AppContent />
          </SetupProvider>
        </AppProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
