import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./styles.css";
import { AppShell, PublicLayout, RequireAuth } from "./Layout.js";
import { SessionProvider, useActiveWorkspace, useSession } from "./state.js";
import { initTheme } from "./theme.js";
import { BlocksAuthProvider } from "./blocks-auth.js";
import { BlocksCallback } from "./pages/BlocksCallback.js";
import { SsoProfile } from "./pages/SsoProfile.js";
import type { WorkspaceSummary } from "./api.js";
import { Features, Landing, SecurityPage } from "./pages/Public.js";
import { Login } from "./pages/Auth.js";
import { Profile } from "./pages/Profile.js";
import { Dashboard, Welcome } from "./pages/Dashboard.js";
import { MyLanguage } from "./pages/MyLanguage.js";
import { DictionaryPage } from "./pages/Dictionary.js";
import { TranslationLab, WordBuilder } from "./pages/Tools.js";
import { Practice } from "./pages/Practice.js";
import { ActivityLog, SecurityAccess, Settings } from "./pages/Workspace.js";
import { AppToaster } from "./ui.js";

/** Injects the active workspace (from session + localStorage) into app pages. */
function WithWorkspace({ render }: { render: (ws: WorkspaceSummary) => React.ReactNode }) {
  const { workspaces } = useSession();
  const [active] = useActiveWorkspace(workspaces);
  if (!active) return null;
  return <>{render(active)}</>;
}

const wsRoute = (path: string, render: (ws: WorkspaceSummary) => React.ReactNode) => (
  <Route path={path} element={<WithWorkspace render={render} />} />
);

function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Landing />} />
        <Route path="/features" element={<Features />} />
        <Route path="/security" element={<SecurityPage />} />
      </Route>

      <Route path="/login" element={<Login />} />
      <Route path="/login/callback" element={<BlocksCallback />} />
      <Route path="/sso" element={<SsoProfile />} />

      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="welcome" element={<Welcome />} />
        <Route path="profile" element={<Profile />} />
        {wsRoute("dashboard", (ws) => <Dashboard key={ws.id} />)}
        {wsRoute("language", (ws) => <MyLanguage key={ws.id} workspace={ws} />)}
        {wsRoute("dictionary", (ws) => <DictionaryPage key={ws.id} workspace={ws} />)}
        {wsRoute("word-builder", (ws) => <WordBuilder key={ws.id} workspace={ws} />)}
        {wsRoute("translate", (ws) => <TranslationLab key={ws.id} workspace={ws} />)}
        {wsRoute("practice", (ws) => <Practice key={ws.id} workspace={ws} />)}
        {wsRoute("security", (ws) => <SecurityAccess key={ws.id} workspace={ws} />)}
        {wsRoute("activity", (ws) => <ActivityLog key={ws.id} workspace={ws} />)}
        {wsRoute("settings", (ws) => <Settings key={ws.id} workspace={ws} />)}
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <BlocksAuthProvider>
        <SessionProvider>
          <AppToaster />
          <AppRoutes />
        </SessionProvider>
      </BlocksAuthProvider>
    </BrowserRouter>
  </StrictMode>
);
