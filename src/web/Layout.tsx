import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Activity, BookOpen, BookMarked, Languages, LayoutDashboard, LogOut, Menu, Moon, RefreshCw,
  Settings, Shield, Sparkles, Sun, User, X
} from "lucide-react";
import { useSession, useActiveWorkspace, useToast } from "./state.js";
import { saveTheme, type Theme } from "./theme.js";
import { useBlocksAuth } from "./blocks-auth.js";
import { api } from "./api.js";
import { LoadingScreen } from "./ui.js";

export function BrandMark({ light }: { light?: boolean }) {
  return (
    <span className="brand" style={light ? { color: "#fff" } : undefined}>
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
        <path d="M8 4v18h12" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="24" cy="26" r="4" fill="#0F9D8A" />
        <circle cx="24" cy="8" r="2.5" fill="#7667D8" />
        <path d="M24 10.5v11.5" stroke="#7667D8" strokeWidth="1.6" strokeDasharray="2.5 3" />
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
          <Link to="/features" className="hide-sm">Features</Link>
          <Link to="/security" className="hide-sm">Security</Link>
          <Link to="/login">Sign in</Link>
          <Link to="/signup" className="btn btn-primary btn-sm" style={{ textDecoration: "none" }}>
            Get started
          </Link>
        </nav>
      </header>
      {children ?? <Outlet />}
      <footer className="public-footer">
        Lexora — your business's own private language. A constructed language is a communication tool, not encryption.
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
  { to: "/app/activity", label: "Activity Log", icon: Activity },
  { to: "/app/settings", label: "Settings", icon: Settings }
];

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { loading, user } = useSession();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export function AppShell() {
  const { user, workspaces, refresh } = useSession();
  const [active, select] = useActiveWorkspace(workspaces);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"));
  const menuRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const blocks = useBlocksAuth();

  useEffect(() => {
    setDrawerOpen(false);
    setMenuOpen(false);
  }, [location.pathname]);

  // Close the avatar menu on any outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

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

  return (
    <div className="shell">
      {drawerOpen && <div className="scrim" onClick={() => setDrawerOpen(false)} />}
      <aside className={`sidebar ${drawerOpen ? "open" : ""}`} aria-label="Main navigation">
        <div className="sidebar-brand">
          <BrandMark />
          <button className="btn btn-ghost btn-icon" style={{ marginLeft: "auto", color: "var(--text)" }} onClick={() => setDrawerOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <nav className="sidebar-nav">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? "active" : "")}>
              <Icon size={17} /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="ws-name">{active.name}</div>
          <div>{active.role} · {active.wordCount} words</div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="btn btn-outline btn-icon menu-btn" onClick={() => setDrawerOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <select
            className="select"
            value={active.id}
            onChange={(e) => select(e.target.value)}
            aria-label="Switch workspace"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              className="theme-toggle"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
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
              {firstName.slice(0, 1).toUpperCase()}
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
