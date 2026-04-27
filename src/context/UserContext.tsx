import React, { createContext, useContext, useState, useEffect } from "react";
import { useAuth } from "./AuthContext";

interface CurrentUser {
  userId: string;
  username: string;
  role: string;
  displayName: string;
}

interface UserContextType {
  currentUser: CurrentUser | null;
  isAdmin: boolean;
  loading: boolean;
  authMode: "none" | "token" | "unknown";
}

const UserContext = createContext<UserContextType>({
  currentUser: null,
  isAdmin: true,
  loading: true,
  authMode: "unknown",
});

function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    let base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4 !== 0) base64 += "=";
    const json = atob(base64);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function parseUserFromToken(token: string): CurrentUser | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  return {
    userId: payload.user_id || payload.UserID || payload.sub || "",
    username: payload.username || payload.Username || "",
    role: payload.role || payload.Role || "user",
    displayName: payload.username || payload.Username || payload.display_name || "",
  };
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const { token, isAuthenticated } = useAuth();

  useEffect(() => {
    if (isAuthenticated && token) {
      const user = parseUserFromToken(token);
      setCurrentUser(user);
    } else {
      setCurrentUser(null);
    }
    setLoading(false);
  }, [isAuthenticated, token]);

  const authMode = isAuthenticated && token ? "token" : "none";
  const isAdmin = authMode === "none" ? false : currentUser?.role === "admin";

  return (
    <UserContext.Provider
      value={{
        currentUser,
        isAdmin,
        loading,
        authMode,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useCurrentUser() {
  return useContext(UserContext);
}
