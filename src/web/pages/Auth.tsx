import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useSession } from "../state.js";
import { useBlocksAuth } from "../blocks-auth.js";
import { loadSession } from "../lib/sso-bridge.js";
import { isLoginConfigured } from "../lib/blocks/config.js";
import { Button, ErrorNote, Spinner } from "../ui.js";

function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div style={{ textAlign: "center", fontWeight: 700, fontSize: 20, color: "var(--primary)", marginBottom: 18 }}>
          <Link to="/" style={{ color: "inherit", textDecoration: "none" }}>Lexora</Link>
        </div>
        <div className="card">
          <h2 style={{ marginBottom: 16 }}>{title}</h2>
          {children}
        </div>
      </div>
    </div>
  );
}

/* Sign-in is Blocks SSO only -- Lexora has no email/password login. The
   button starts the hosted OIDC round-trip; /login/callback bridges the IAM
   session into the app's own session and lands in the workspace. */
export function Login() {
  const { loading, user, setSession } = useSession();
  const blocks = useBlocksAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading || blocks.status === "loading") {
    return (
      <AuthShell title="Sign in">
        <Spinner />
      </AuthShell>
    );
  }
  if (user) return <Navigate to="/app" replace />;

  const signIn = () => {
    setError(null);
    blocks.login("/app").catch((e: unknown) => {
      setError(e instanceof Error ? e.message : "Could not start SSO sign-in.");
    });
  };

  // The IAM session is already alive (e.g. the user signed out of the app
  // earlier, which leaves the hosted login standing) -- skip the redirect
  // and bridge straight into the app session.
  const continueSession = async () => {
    setBusy(true);
    setError(null);
    try {
      const me = await loadSession();
      setSession(me.user, me.workspaces);
      navigate(me.workspaces.length > 0 ? "/app/dashboard" : "/app/welcome", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete sign-in.");
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Sign in">
      {blocks.status === "authenticated" ? (
        <>
          <p>
            You are signed in to Blocks as{" "}
            <strong>{String((blocks.claims as { email?: string } | undefined)?.email ?? "a Blocks user")}</strong>.
          </p>
          <Button type="button" disabled={busy} style={{ width: "100%" }} onClick={() => void continueSession()}>
            {busy ? "Entering…" : "Continue to the app"}
          </Button>
        </>
      ) : (
        <>
          <p className="bilingual">Use your organisation's SELISE Blocks account; there is no separate Lexora password.</p>
          <Button type="button" disabled={!isLoginConfigured()} style={{ width: "100%" }} onClick={signIn}>
            Sign in with Blocks SSO
          </Button>
          {!isLoginConfigured() && (
            <ErrorNote message="SSO is not configured. Set VITE_BLOCKS_OIDC_CLIENT_ID in .env." />
          )}
        </>
      )}
      <ErrorNote message={error} />
    </AuthShell>
  );
}
