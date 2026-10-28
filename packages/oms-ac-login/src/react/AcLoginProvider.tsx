"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { PublicAcUser } from "../core/types";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AcLoginContextValue {
  status: AuthStatus;
  user: PublicAcUser | null;
  refresh: () => Promise<void>;
  logout: () => void;
}

const AcLoginContext = createContext<AcLoginContextValue | null>(null);

export function AcLoginProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<PublicAcUser | null>(null);

  const refresh = useCallback(async () => {
    setStatus("loading");
    const response = await fetch("/api/ac/me", { credentials: "include" });
    if (!response.ok) {
      setUser(null);
      setStatus("unauthenticated");
      return;
    }

    const data = (await response.json()) as { user: PublicAcUser };
    setUser(data.user);
    setStatus("authenticated");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AcLoginContextValue>(
    () => ({
      status,
      user,
      refresh,
      logout() {
        window.location.href = "/api/ac/auth/logout";
      }
    }),
    [refresh, status, user]
  );

  return <AcLoginContext.Provider value={value}>{children}</AcLoginContext.Provider>;
}

export function useAcAuthContext() {
  const context = useContext(AcLoginContext);
  if (!context) throw new Error("useAcAuthContext must be used inside AcLoginProvider");
  return context;
}
