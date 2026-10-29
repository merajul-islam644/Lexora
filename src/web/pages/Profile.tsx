import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, ErrorNote, HonestNote, PageHeader, Spinner } from "../ui.js";
import { useSession } from "../state.js";
import { toast } from "sonner";
import { useBlocksAuth } from "../blocks-auth.js";
import { blocksClient } from "../lib/blocks/client.js";
import { api } from "../api.js";

const ROLE_TONE = { owner: "teal", admin: "violet", editor: "amber", viewer: "gray" } as const;

/* Avatar bytes go to Blocks Storage (Azure) against a pre-signed URL minted
   browser-side with the signed-in user's own token; only the file-id pointer
   is app data (Gateway). */
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type IamAccess = { roles: string[]; permissions: string[] };

/* The signed-in user's own account. Identity comes from the app session
   (the function resolves it from the Blocks IAM token); roles, permissions
   and organizations are read live from the SELISE Blocks IAM directory with
   the caller's own token. Everything shown here is real session data — no
   editable profile lives in Lexora, because the account belongs to IAM. */
export function Profile() {
  const { user, workspaces, organizations, avatarUrl, setAvatarUrl } = useSession();
  const blocks = useBlocksAuth();
  const [iam, setIam] = useState<IamAccess | null>(null);
  const [iamFailed, setIamFailed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    document.title = "Profile · Lexora";
  }, []);

  // Live IAM reads, scoped to the signed-in user: their roles and permissions.
  // Read-only platform calls. Organizations ride the session (GET /api/me).
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await blocksClient.iam.me();
        const u = (res.data ?? {}) as { roles?: string[]; permissions?: string[] };
        if (alive) setIam({ roles: u.roles ?? [], permissions: u.permissions ?? [] });
      } catch {
        if (alive) setIamFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // The avatar itself comes from the session layer (shared with the topbar);
  // this page only uploads/removes it and updates the shared URL.

  if (!user) return null;

  const onPickFile = (file: File | undefined) => {
    if (!file) return;
    setAvatarError(null);
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setAvatarError("Please choose a PNG, JPEG or WebP image.");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError("Image must be 5 MB or smaller.");
      return;
    }
    void (async () => {
      setUploading(true);
      try {
        // The function (its own identity) mints the pre-signed URL; the SPA
        // PUTs the bytes straight to Azure — no bearer token on that hop, but
        // the presign's requiredHeaders must ride along.
        const presign = await api.post<{ uploadUrl: string; fileId: string; requiredHeaders?: Record<string, string> }>("/api/me/avatar/upload-url", {
          fileName: file.name,
          contentType: file.type
        });
        await blocksClient.data.files.uploadToUrl({ url: presign.uploadUrl, body: file, contentType: file.type, headers: presign.requiredHeaders });
        await api.patch("/api/me/avatar", { fileId: presign.fileId });
        const fresh = await api.get<{ downloadUrl: string | null }>("/api/me/avatar");
        setAvatarUrl(fresh.downloadUrl);
        toast.success("Profile photo updated.");
      } catch (e) {
        setAvatarError(e instanceof Error ? e.message : "Could not upload the photo.");
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    })();
  };

  const removeAvatar = () => {
    void (async () => {
      setUploading(true);
      setAvatarError(null);
      try {
        await api.del("/api/me/avatar");
        setAvatarUrl(null);
        toast("Profile photo removed.");
      } catch (e) {
        setAvatarError(e instanceof Error ? e.message : "Could not remove the photo.");
      } finally {
        setUploading(false);
      }
    })();
  };

  const claims = blocks.claims as { name?: string; preferred_username?: string } | undefined;
  const displayName = user.name || claims?.name || user.email.split("@")[0] || "You";
  const memberSince = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString(undefined, {
        year: "numeric", month: "long", day: "numeric"
      })
    : "";

  return (
    <div>
      <PageHeader title="Profile" subtitle="Your account: who you are in this app." />

      <div className="profile-page">
        {/* Identity */}
        <div className="card">
          <div className="profile-head">
            {avatarUrl ? (
              <img className="profile-avatar profile-avatar-img" src={avatarUrl} alt="Your profile" />
            ) : (
              <div className="profile-avatar" aria-hidden="true">
                {initialsOf(displayName)}
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 19, marginBottom: 2 }}>{displayName}</div>
              <div style={{ color: "var(--text-muted)", wordBreak: "break-all", marginBottom: 6 }}>{user.email}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {user.emailVerified
                  ? <Badge tone="green">Verified</Badge>
                  : <Badge tone="amber">Verification pending</Badge>}
                <Badge tone="navy">SELISE Blocks SSO</Badge>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: "none" }}
              onChange={(e) => onPickFile(e.target.files?.[0])}
            />
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? "Working…" : avatarUrl ? "Change photo" : "Upload photo"}
            </button>
            {avatarUrl && (
              <button type="button" className="btn btn-outline btn-sm" disabled={uploading} onClick={removeAvatar}>
                Remove
              </button>
            )}
            {uploading && <Spinner />}
          </div>
          {avatarError && <ErrorNote message={avatarError} />}

          <div className="profile-rows" style={{ marginTop: 16 }}>
            <div className="profile-row">
              <span>Member since</span>
              <span>{memberSince}</span>
            </div>
            {claims?.preferred_username && (
              <div className="profile-row">
                <span>Blocks account</span>
                <span style={{ wordBreak: "break-all" }}>{String(claims.preferred_username)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Platform roles & permissions — live from IAM */}
        <div className="card">
          <h3 className="card-section-title">Platform roles & permissions</h3>
          <p className="card-section-sub">
            What the SELISE Blocks platform says about your account, read live from IAM.
          </p>
          {iam !== null ? (
            <>
              <div className="role-chips">
                {iam.roles.length > 0 ? (
                  iam.roles.map((role) => <Badge key={role} tone="navy">{role}</Badge>)
                ) : (
                  <span className="bilingual" style={{ color: "var(--text-muted)", fontSize: 13 }}>
                    No platform roles assigned.
                  </span>
                )}
              </div>
              {iam.permissions.length > 0 && (
                <>
                  <div className="card-section-sub" style={{ margin: "4px 0 6px" }}>
                    {iam.permissions.length} {iam.permissions.length === 1 ? "permission" : "permissions"} granted through your roles:
                  </div>
                  <div className="perm-grid">
                    {iam.permissions.map((perm) => (
                      <div className="perm-item" key={perm}>
                        <span className="perm-code">{perm}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : iamFailed ? (
            <p className="bilingual" style={{ margin: 0, color: "var(--text-muted)" }}>
              Couldn't load your platform roles right now.
            </p>
          ) : (
            <p className="bilingual" style={{ margin: 0, color: "var(--text-muted)" }}>Loading…</p>
          )}
        </div>

        {/* Workspaces — the app's own domain roles */}
        <div className="card">
          <h3 className="card-section-title">Your workspaces</h3>
          <p className="card-section-sub">
            {workspaces.length === 1 ? "1 workspace" : `${workspaces.length} workspaces`}; your role here decides what
            you can change, enforced by the Lexora function on every call.
          </p>
          <div className="profile-rows">
            {workspaces.map((ws) => {
              const orgName = organizations.find((o) => o.id === ws.organizationId)?.name;
              return (
                <div className="profile-row" key={ws.id} style={{ gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {ws.name}
                      {orgName && <Badge tone="navy">{orgName}</Badge>}
                      <Badge tone={ROLE_TONE[ws.role]}>{ws.role}</Badge>
                    </div>
                    <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 2 }}>
                      {ws.languageName ? `${ws.languageName} · ` : "No language yet · "}
                      {ws.wordCount} {ws.wordCount === 1 ? "word" : "words"}
                    </div>
                  </div>
                  <Link to="/app/dashboard" style={{ fontSize: 13, flexShrink: 0 }}>Open</Link>
                </div>
              );
            })}
            {workspaces.length === 0 && (
              <p className="bilingual" style={{ margin: 0, color: "var(--text-muted)" }}>
                No workspaces yet; create one from the dashboard.
              </p>
            )}
          </div>
        </div>

        {/* Organizations (IAM) */}
        <div className="card">
          <h3 className="card-section-title">Organizations</h3>
          <p className="card-section-sub">Your memberships in the SELISE Blocks directory.</p>
          {organizations.length === 0 && (
            <p className="bilingual" style={{ margin: 0, color: "var(--text-muted)" }}>
              Your account isn't listed in any organization.
            </p>
          )}
          {organizations.map((org) => (
            <div className="profile-row" key={org.id}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{org.name}</span>
              <span style={{ color: "var(--text-muted)", fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
                {org.id}
              </span>
            </div>
          ))}
        </div>

        <HonestNote>
          <p style={{ margin: 0 }}>
            Your account, platform roles, permissions and organizations are managed by your organisation's SELISE Blocks
            directory; Lexora keeps no password and no editable profile. Workspace roles are Lexora's own and live in its
            membership records. Sign-out ends the session on this device only.
          </p>
        </HonestNote>
      </div>
    </div>
  );
}
