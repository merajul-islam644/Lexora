import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type PublicUser, type WorkspaceSummary } from "./api.js";

/* ------------------------------- session ----------------------------------- */

interface SessionContextValue {
  loading: boolean;
  user: PublicUser | null;
  workspaces: WorkspaceSummary[];
  /** The caller's SELISE Blocks organizations (IAM directory) — read once
      with /api/me and shared by the workspace picker, create form, Profile. */
  organizations: Array<{ id: string; name: string }>;
  /** The caller's profile photo download URL — shared by the topbar and the
      Profile page; download URLs are short-lived, so it rides each refresh. */
  avatarUrl: string | null;
  setAvatarUrl: (url: string | null) => void;
  refresh: () => Promise<void>;
  setSession: (user: PublicUser, workspaces: WorkspaceSummary[]) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([]);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<{
        user: PublicUser;
        workspaces: WorkspaceSummary[];
        organizations?: Array<{ id: string; name: string }>;
      }>("/api/me");
      setUser(me.user);
      setWorkspaces(me.workspaces);
      // Array.isArray guard: a non-array here used to sit in context until the
      // first .map/.find consumer unmounted the whole app (white screen).
      setOrganizations(Array.isArray(me.organizations) ? me.organizations : []);
    } catch {
      setUser(null);
      setWorkspaces([]);
      setOrganizations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The avatar pointer lives in the Gateway; the short-lived download URL is
  // resolved browser-side with the signed-in user's own token (files.get), so
  // re-fetch per session load. A missing/unreadable photo just leaves the
  // initials fallback.
  useEffect(() => {
    if (!user) {
      setAvatarUrl(null);
      return;
    }
    let alive = true;
    void api
      .get<{ fileId: string | null; downloadUrl: string | null }>("/api/me/avatar")
      .then((res) => {
        if (alive) setAvatarUrl(res.downloadUrl);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [user]);

  const value = useMemo<SessionContextValue>(
    () => ({
      loading,
      user,
      workspaces,
      organizations,
      avatarUrl,
      setAvatarUrl,
      refresh,
      setSession: (u, ws) => {
        setUser(u);
        setWorkspaces(ws);
      }
    }),
    [loading, user, workspaces, organizations, avatarUrl, refresh]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession outside SessionProvider");
  return ctx;
}

/* ---------------------------- active workspace ------------------------------ */

const ACTIVE_WS_KEY = "lexora.activeWorkspace";

export function useActiveWorkspace(workspaces: WorkspaceSummary[]): [WorkspaceSummary | null, (id: string) => void] {
  const [activeId, setActiveId] = useState<string>(() => localStorage.getItem(ACTIVE_WS_KEY) ?? "");

  const valid = workspaces.find((w) => w.id === activeId) ?? workspaces[0] ?? null;
  useEffect(() => {
    if (valid && valid.id !== activeId) setActiveId(valid.id);
  }, [valid, activeId]);

  const select = useCallback((id: string) => {
    localStorage.setItem(ACTIVE_WS_KEY, id);
    setActiveId(id);
  }, []);

  return [valid, select];
}
