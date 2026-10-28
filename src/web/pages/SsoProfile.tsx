import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useBlocksAuth } from "../blocks-auth.js";
import { loadSession } from "../lib/sso-bridge.js";
import { useSession } from "../state.js";
import { Button, ErrorNote, LoadingScreen, PageHeader } from "../ui.js";

/* Shows the signed-in user's Blocks session claims and a sign-out button.
   Not part of the local-session /app area -- this page is the debug view
   for the hosted login (OIDC) and the way in for users who completed SSO
   before the callback bridge existed. */
export function SsoProfile() {
  const { claims, logout, status } = useBlocksAuth();
  const { setSession } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === "loading") return <LoadingScreen />;
  if (status === "unauthenticated") return <Navigate to="/login" replace />;

  const continueToApp = async () => {
    setBusy(true);
    setError(null);
    try {
      const me = await loadSession();
      setSession(me.user, me.workspaces);
      navigate(me.workspaces.length > 0 ? "/app/dashboard" : "/app/welcome", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enter the app.");
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: "48px auto", padding: "0 16px" }}>
      <PageHeader
        title="Signed in with Blocks SSO"
        subtitle="This session comes from the SELISE Blocks hosted login (OIDC)."
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <Button disabled={busy} onClick={() => void continueToApp()}>
              {busy ? "Entering…" : "Continue to the app"}
            </Button>
            <Button
              onClick={async () => {
                await logout();
                navigate("/", { replace: true });
              }}
            >
              Sign out
            </Button>
          </div>
        }
      />
      <ErrorNote message={error} />
      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ marginBottom: 8 }}>Session claims</h3>
        <pre style={{ margin: 0, fontSize: 13, overflow: "auto", whiteSpace: "pre-wrap" }}>
          {JSON.stringify(claims, null, 2)}
        </pre>
      </div>
    </div>
  );
}
