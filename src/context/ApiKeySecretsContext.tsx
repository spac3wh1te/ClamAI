import React, { createContext, useContext, useState, useCallback } from "react";
import { keysApi } from "../api/keys";

interface ApiKeySecretsContextType {
  secrets: Record<string, string>;
  revealKey: (id: string) => Promise<string>;
  getSecret: (id: string) => string | undefined;
  setSecret: (id: string, key: string) => void;
  clearSecret: (id: string) => void;
}

const ApiKeySecretsContext = createContext<ApiKeySecretsContextType | null>(
  null,
);

export function ApiKeySecretsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [secrets, setSecrets] = useState<Record<string, string>>({});

  const revealKey = useCallback(
    async (id: string): Promise<string> => {
      if (secrets[id]) {
        return secrets[id];
      }
      try {
        const revealed = await keysApi.reveal(id);
        setSecrets((prev) => ({ ...prev, [revealed.id]: revealed.key }));
        return revealed.key;
      } catch (e) {
        console.error("Failed to reveal key:", e);
        throw e;
      }
    },
    [secrets],
  );

  const getSecret = useCallback(
    (id: string): string | undefined => {
      return secrets[id];
    },
    [secrets],
  );

  const setSecret = useCallback((id: string, key: string) => {
    setSecrets((prev) => ({ ...prev, [id]: key }));
  }, []);

  const clearSecret = useCallback((id: string) => {
    setSecrets((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  return (
    <ApiKeySecretsContext.Provider
      value={{ secrets, revealKey, getSecret, setSecret, clearSecret }}
    >
      {children}
    </ApiKeySecretsContext.Provider>
  );
}

export function useApiKeySecrets() {
  const context = useContext(ApiKeySecretsContext);
  if (!context) {
    throw new Error(
      "useApiKeySecrets must be used within ApiKeySecretsProvider",
    );
  }
  return context;
}
