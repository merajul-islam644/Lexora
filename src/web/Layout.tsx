import { useEffect, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  Activity,
  BookOpen,
  BookMarked,
  Building2,
  Check,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Languages,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  RefreshCw,
  Settings,
  Shield,
  Sparkles,
  Sun,
  User,
} from "lucide-react";
import { useSession, useActiveWorkspace } from "./state.js";
import { toast } from "sonner";
import { saveTheme, THEME_EVENT, type Theme } from "./theme.js";
import { useBlocksAuth } from "./blocks-auth.js";
import { api } from "./api.js";
import { LoadingScreen } from "./ui.js";

export function BrandMark({ light }: { light?: boolean }) {
  return (
    <span className="brand" style={light ? { color: "#fff" } : undefined}>
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
        <path
          d="M8 4v18h12"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="24" cy="26" r="4" fill="#0F9D8A" />
        <circle cx="24" cy="8" r="2.5" fill="#7667D8" />
        <path
          d="M24 10.5v11.5"
          stroke="#7667D8"
          strokeWidth="1.6"
          strokeDasharray="2.5 3"
        />
      </svg>
      Lexora
    </span>
  );
}

/* --------------------------------- public shell ------------------------------ */

export function PublicLayout({ children }: { children?: React.ReactNode }) {
  return (
    <div>
      <header className="public-header">
        <Link to="/" style={{ textDecoration: "none" }}>
          <BrandMark />
        </Link>
        <nav>
          <Link to="/features" className="hide-sm">
            Features
          </Link>
          <Link to="/security" className="hide-sm">
            Security
          </Link>
          <Link to="/login">Sign in</Link>
          <Link
            to="/signup"
            className="btn btn-primary btn-sm"
            style={{ textDecoration: "none" }}
          >
            Get started
          </Link>
        </nav>
      </header>
      {children ?? <Outlet />}
      <footer className="public-footer">
        Lexora: your business's own private language. A constructed language is
        a communication tool, not encryption.
      </footer>
    </div>
  );
}

/* ---------------------------------- app shell -------------------------------- */

const NAV = [
  { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/app/language", label: "My Language", icon: Sparkles },
  { to: "/app/dictionary", label: "Dictionary", icon: BookOpen },
  { to: "/app/word-builder", label: "Word Builder", icon: BookMarked },
  { to: "/app/translate", label: "Translation Lab", icon: Languages },
  { to: "/app/practice", label: "Practice & Revision", icon: RefreshCw },
  { to: "/app/security", label: "Security & Access", icon: Shield },
  { to: "/app/console", label: "IAM Console", icon: Building2 },
  { to: "/app/activity", label: "Activity Log", icon: Activity },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { loading, user } = useSession();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export function AppShell() {
  const { user, workspaces, organizations, refresh, avatarUrl } = useSession();
  const [active, select] = useActiveWorkspace(workspaces);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Desktop sidebar rail: collapsed hides the labels (icons only), persisted
  // like the active workspace. On drawer widths the toggle just closes it.
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("lexora.sidebarCollapsed") === "1",
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [wsOpen, setWsOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );
  const menuRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const blocks = useBlocksAuth();

  useEffect(() => {
    setDrawerOpen(false);
    setMenuOpen(false);
    setWsOpen(false);
  }, [location.pathname]);

  // Close the avatar menu and the workspace switcher on any outside click or Escape.
  useEffect(() => {
    if (!menuOpen && !wsOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
      if (wsRef.current && !wsRef.current.contains(e.target as Node))
        setWsOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setWsOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, wsOpen]);

  // The Settings page can also switch the theme; keep the top-bar icon in sync.
  useEffect(() => {
    const onTheme = (e: Event) => setTheme((e as CustomEvent<Theme>).detail);
    window.addEventListener(THEME_EVENT, onTheme);
    return () => window.removeEventListener(THEME_EVENT, onTheme);
  }, []);

  if (!user) return null;

  if (!active) {
    // First-run: with no workspaces there is nothing to activate, and the
    // welcome route (which creates the first workspace) lives INSIDE this
    // shell -- render it instead of spinning forever.
    if (location.pathname.startsWith("/app/welcome")) {
      return (
        <div className="main" style={{ minHeight: "100vh" }}>
          <main className="content">
            <Outlet />
          </main>
        </div>
      );
    }
    return <Navigate to="/app/welcome" replace />;
  }

  // Ends the Blocks IAM session -- with SSO as the only sign-in, an alive IAM
  // session would make sign-out a one-click undo. There is no app-side session
  // cookie anymore; /me just reads the caller's token.
  const logout = async () => {
    await blocks.logout();
    await refresh();
    toast("Signed out.");
    navigate("/login");
  };

  const firstName = user.email.split("@")[0] ?? "there";

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    saveTheme(next);
  };

  const toggleSidebar = () => {
    if (window.innerWidth <= 900) {
      setDrawerOpen(false);
      return;
    }
    setCollapsed((v) => {
      localStorage.setItem("lexora.sidebarCollapsed", v ? "0" : "1");
      return !v;
    });
  };

  return (
    <div className="shell">
      {drawerOpen && (
        <div className="scrim" onClick={() => setDrawerOpen(false)} />
      )}
      <aside
        className={`sidebar ${drawerOpen ? "open" : ""} ${collapsed ? "collapsed" : ""}`}
        aria-label="Main navigation"
      >
        <div className="sidebar-brand">
          <BrandMark />
          <button
            className="btn btn-ghost btn-icon"
            style={{ marginLeft: "auto", color: "var(--text)" }}
            onClick={toggleSidebar}
            aria-label={collapsed ? "Expand sidebar" : "Minimize sidebar"}
            title={collapsed ? "Expand sidebar" : "Minimize sidebar"}
          >
            {collapsed ? (
              <ChevronsRight size={18} />
            ) : (
              <ChevronsLeft size={18} />
            )}
          </button>
        </div>
        <nav className="sidebar-nav">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => (isActive ? "active" : "")}
              title={label}
            >
              <Icon size={17} /> <span className="nav-label">{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer" ref={wsRef}>
          <button
            type="button"
            className={wsOpen ? "ws-switch open" : "ws-switch"}
            aria-haspopup="menu"
            aria-expanded={wsOpen}
            aria-label="Switch workspace"
            onClick={() => setWsOpen((v) => !v)}
          >
            <span className="ws-switch-info">
              <span className="ws-name">{active.name}</span>
              <span className="ws-meta">
                {active.role} · {active.wordCount} words
              </span>
            </span>
            <ChevronDown size={14} />
          </button>
          {wsOpen && (
            <div
              className="menu sidebar-ws-menu"
              role="menu"
              aria-label="Workspaces"
            >
              {workspaces.map((w) => {
                const orgName = organizations.find((o) => o.id === w.organizationId)?.name;
                return (
                  <button
                    key={w.id}
                    type="button"
                    role="menuitem"
                    className={w.id === active.id ? "on" : ""}
                    onClick={() => {
                      setWsOpen(false);
                      select(w.id);
                    }}
                  >
                    <span className="ws-item">
                      <span className="ws-item-name">{w.name}</span>
                      <span className="ws-item-meta">
                        {orgName ? `${orgName} · ` : ""}
                        {w.role} · {w.wordCount} words
                      </span>
                    </span>
                    {w.id === active.id && <Check size={15} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button
            className="btn btn-outline btn-icon menu-btn"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={18} />
          </button>
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <button
              type="button"
              className="theme-toggle"
              onClick={toggleTheme}
              aria-label={
                theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
              title={
                theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <div className="avatar-menu" ref={menuRef}>
              <button
                type="button"
                className="avatar-btn"
                aria-label="Account menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
              >
                {avatarUrl ? (
                  <img className="avatar-btn-img" src={avatarUrl} alt="" />
                ) : (
                  firstName.slice(0, 1).toUpperCase()
                )}
              </button>
              {menuOpen && (
                <div className="menu" role="menu">
                  <div className="menu-head">
                    <div className="menu-name">{firstName}</div>
                    <div className="menu-mail">{user.email}</div>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      navigate("/app/profile");
                    }}
                  >
                    <User size={15} /> Profile
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      void logout();
                    }}
                  >
                    <LogOut size={15} /> Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="content">
          <Outlet context={{ workspace: active }} />
        </main>
      </div>
    </div>
  );
}
