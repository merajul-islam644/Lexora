import { useEffect } from "react";
import { Badge, PageHeader } from "../ui.js";
import { useSession } from "../state.js";
import { useBlocksAuth } from "../blocks-auth.js";

/* The signed-in user's own account. Identity comes from the app session
   (provisioned from the Blocks IAM claims at sign-in); the claims block is
   whatever the hosted OIDC login told us about the person. */
export function Profile() {
  const { user, workspaces } = useSession();
  const blocks = useBlocksAuth();

  useEffect(() => {
    document.title = "Profile — Lexora";
  }, []);

  if (!user) return null;

  const claims = blocks.claims as { name?: string; preferred_username?: string } | undefined;
  const displayName = claims?.name || user.email.split("@")[0] || "You";
  const initial = displayName.slice(0, 1).toUpperCase();
  const memberSince = new Date(user.createdAt).toLocaleDateString(undefined, {
    year: "numeric", month: "long", day: "numeric"
  });

  return (
    <div>
      <PageHeader title="Profile" subtitle="Your account — who you are in this app." />

      <div className="card" style={{ maxWidth: 620 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            aria-hidden="true"
            style={{
              width: 56, height: 56, borderRadius: "50%", background: "var(--accent)", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 24, flexShrink: 0
            }}
          >
            {initial}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{displayName}</div>
            <div style={{ color: "var(--text-muted)", wordBreak: "break-all" }}>{user.email}</div>
          </div>
        </div>

        <div className="profile-rows" style={{ marginTop: 18 }}>
          <div className="profile-row">
            <span>Sign-in method</span>
            <span>SELISE Blocks SSO</span>
          </div>
          <div className="profile-row">
            <span>Email verified</span>
            {user.emailVerified ? <Badge tone="green">Verified</Badge> : <Badge tone="amber">Pending</Badge>}
          </div>
          <div className="profile-row">
            <span>Member since</span>
            <span>{memberSince}</span>
          </div>
          <div className="profile-row">
            <span>Workspaces</span>
            <span>{workspaces.length}</span>
          </div>
          {claims?.preferred_username && (
            <div className="profile-row">
              <span>Blocks account</span>
              <span style={{ wordBreak: "break-all" }}>{String(claims.preferred_username)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
