import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchSessionClaims, logout as endSession, onSessionExpired, startLogin } from "./lib/blocks/auth.js";

type AuthStatus = "authenticated" | "loading" | "unauthenticated";

type BlocksAuthContextValue = {
  claims: Record<string, unknown> | undefined;
  login: (returnTo?: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  status: AuthStatus;
};

const BlocksAuthContext = createContext<BlocksAuthContextValue | undefined>(undefined);

// A long backup interval, not the primary signal -- polling auth/me every
// few seconds would hit IAM constantly even while the tab sits idle in the
// background. Regaining focus (below) is what actually needs to be prompt,
// e.g. after signing out in another tab or the session expiring meanwhile.
const STATUS_POLL_MS = 5 * 60_000;

/* Blocks hosted-login session state, parallel to the local SessionProvider:
   the session's source of truth is IAM's GET /iam/v4/auth/me
   (blocksClient.auth.userInfo()), not a token this app can inspect -- the
   default hosted login flow sets the session as a Secure, httpOnly cookie
   that never reaches this app's JS. */

export function BlocksAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [claims, setClaims] = useState<Record<string, unknown> | undefined>();

  const refresh = useCallback(async () => {
    const sessionClaims = await fetchSessionClaims();
    setClaims(sessionClaims);
    setStatus(sessionClaims ? "authenticated" : "unauthenticated");
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(refresh, STATUS_POLL_MS);

    function onVisible() {
      if (document.visibilityState === "visible") void refresh();
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // Fires when a reactive 401 forced a refresh and IAM rejected the refresh
  // token outright (invalid_grant) -- lib/blocks/auth.js already ended the
  // session server-side, this just gets the UI to notice.
  useEffect(() => onSessionExpired(() => void refresh()), [refresh]);

  const login = useCallback(async (returnTo?: string) => {
    await startLogin(returnTo);
  }, []);

  const logout = useCallback(async () => {
    await endSession();
    await refresh();
  }, [refresh]);

  const value = useMemo<BlocksAuthContextValue>(() => ({
    claims,
    login,
    logout,
    refresh,
    status
  }), [claims, login, logout, refresh, status]);

  return <BlocksAuthContext.Provider value={value}>{children}</BlocksAuthContext.Provider>;
}

export function useBlocksAuth(): BlocksAuthContextValue {
  const context = useContext(BlocksAuthContext);
  if (!context) throw new Error("useBlocksAuth must be used within BlocksAuthProvider");
  return context;
}
