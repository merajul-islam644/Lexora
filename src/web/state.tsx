import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type PublicUser, type WorkspaceSummary } from "./api.js";

/* ------------------------------- session ----------------------------------- */

interface SessionContextValue {
  loading: boolean;
  user: PublicUser | null;
  workspaces: WorkspaceSummary[];
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
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<{ user: PublicUser; workspaces: WorkspaceSummary[] }>("/api/me");
      setUser(me.user);
      setWorkspaces(me.workspaces);
    } catch {
      setUser(null);
      setWorkspaces([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The avatar pointer lives in the Gateway; the function resolves the
  // short-lived download URL with its own identity, so re-fetch per session
  // load. A missing/unreadable photo just leaves the initials fallback.
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
      avatarUrl,
      setAvatarUrl,
      refresh,
      setSession: (u, ws) => {
        setUser(u);
        setWorkspaces(ws);
      }
    }),
    [loading, user, workspaces, avatarUrl, refresh]
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

/* --------------------------------- toasts ----------------------------------- */

interface Toast {
  id: number;
  message: string;
  kind: "info" | "success" | "error";
}

const ToastContext = createContext<{ push: (message: string, kind?: Toast["kind"]) => void } | null>(null);

let toastSeq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, kind: Toast["kind"] = "info") => {
    const id = ++toastSeq;
    setToasts((list) => [...list, { id, message, kind }]);
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4500);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === "error" ? "toast-error" : t.kind === "success" ? "toast-success" : ""}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast outside ToastProvider");
  return ctx.push;
}
