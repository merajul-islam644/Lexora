import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBlocksAuth } from "../blocks-auth.js";
import { completeLogin, fetchSessionClaims } from "../lib/blocks/auth.js";
import { loadSession } from "../lib/sso-bridge.js";
import { useSession } from "../state.js";
import { Button, ErrorNote, Spinner } from "../ui.js";

/* Handles IAM's redirect back to /login/callback. Not wrapped in any auth
   guard -- the user is by definition not yet authenticated when they land
   here. The one-shot effect is ref-guarded so Strict Mode's double-invoke
   does not run completeLogin twice. */
export function BlocksCallback() {
  const { refresh } = useBlocksAuth();
  const { setSession } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | undefined>();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    void (async () => {
      const result = await completeLogin(window.location.href);
      if (!result.ok) {
        setError(result.message);
        return;
      }

      try {
        if (!(await fetchSessionClaims())) throw new Error("The SSO session did not stick. Please try signing in again.");
        await refresh();
        // Load the app session from the function, then land where the login
        // button asked -- or on first-run setup for a brand-new account.
        const me = await loadSession();
        setSession(me.user, me.workspaces);
        navigate(me.workspaces.length > 0 ? result.returnTo || "/app/dashboard" : "/app/welcome", { replace: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not complete sign-in.");
      }
    })();
  }, [refresh, setSession, navigate]);

  if (error) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="card">
            <h2 style={{ marginBottom: 16 }}>Sign-in failed</h2>
            <ErrorNote message={error ?? null} />
            <Button style={{ width: "100%" }} onClick={() => navigate("/login", { replace: true })}>
              Back to sign in
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="card" style={{ textAlign: "center" }}>
          <Spinner />
          <p style={{ color: "var(--text-muted)" }}>Completing sign-in…</p>
        </div>
      </div>
    </div>
  );
}
