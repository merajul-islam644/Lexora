import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldAlert, Trash2, UserPlus } from "lucide-react";
import { api, type PublicUser, type WorkspaceSummary } from "../api.js";
import { useSession, useToast } from "../state.js";
import { useBlocksAuth } from "../blocks-auth.js";
import { Badge, Button, ConfirmDialog, Field, HonestNote, Input, LoadingScreen, PageHeader, Select, Stat } from "../ui.js";
import { formatWhen } from "./Dashboard.js";

type Workspace = { id: string; name: string; role: "owner" | "admin" | "editor" | "viewer" };

const ROLES = ["viewer", "editor", "admin"] as const;

const ROLE_NOTES: Record<string, string> = {
  owner: "Full control, can delete the workspace",
  admin: "Manages members, restores language versions",
  editor: "Adds/edits words, generates languages",
  viewer: "Read-only: dictionary, grammar, practice"
};

/* ------------------------------ security & access ----------------------------- */

export function SecurityAccess({ workspace }: { workspace: Workspace }) {
  const [members, setMembers] = useState<Array<{ user_id: string; role: string; created_at: string; email: string }>>([]);
  const [security, setSecurity] = useState<{ members: number; exportEvents: number; generationRuns: number; dataResidency: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const { workspaces } = useSession();
  const role = workspaces.find((w) => w.id === workspace.id)?.role ?? workspace.role;
  const canManage = role === "owner" || role === "admin";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, s] = await Promise.all([
        api.get<{ members: typeof members }>(`/api/ws/${workspace.id}/members`),
        api.get<typeof security>(`/api/ws/${workspace.id}/security`)
      ]);
      setMembers(m.members);
      setSecurity(s);
    } finally {
      setLoading(false);
    }
  }, [workspace.id]);

  useEffect(() => {
    document.title = "Security & Access — Lexora";
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingScreen />;

  return (
    <div>
      <PageHeader title="Security & Access" subtitle="Who can reach this workspace, and what has been happening in it." />

      <HonestNote>
        Your language lives in an access-controlled workspace. But remember: <strong>a constructed language is not
        encryption</strong> — anyone who learns it can read it. Never use it to protect credentials or personal data.
      </HonestNote>

      <div className="metrics">
        <Stat value={security?.members ?? members.length} label="Members" />
        <Stat value={security?.exportEvents ?? 0} label="Export events" />
        <Stat value={security?.generationRuns ?? 0} label="Generation runs" />
        <Stat value="Single DB" label="Data residency" />
      </div>

      <div className="card">
        <div className="card-title">
          <h3>Members</h3>
          {canManage && <AddMemberButton workspaceId={workspace.id} onAdded={load} />}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Member since</th>
                {canManage && <th></th>}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.user_id}>
                  <td>{m.email}</td>
                  <td>
                    {canManage && m.role !== "owner" ? (
                      <RoleSelect workspaceId={workspace.id} userId={m.user_id} current={m.role} onDone={load} />
                    ) : (
                      <Badge tone={m.role === "owner" ? "teal" : "gray"}>{m.role}</Badge>
                    )}
                    <div className="bilingual" style={{ fontSize: 12 }}>{ROLE_NOTES[m.role]}</div>
                  </td>
                  <td className="bilingual">{formatWhen(m.created_at)}</td>
                  {canManage && (
                    <td>{m.role !== "owner" && <RemoveMemberButton workspaceId={workspace.id} userId={m.user_id} email={m.email} onDone={load} />}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>How your workspace is protected</h3>
        <ul style={{ margin: 0, paddingLeft: 20, color: "var(--text-muted)", fontSize: 14, lineHeight: 1.8 }}>
          <li>Every request is authorized on the server against your session — the browser is never trusted.</li>
          <li>People outside this workspace get "not found" for it, so its existence can't be probed.</li>
          <li>Passwords are hashed (scrypt); sessions are HttpOnly cookies you can revoke any time from Settings.</li>
          <li>Exports, imports and generations are recorded in the Activity Log.</li>
          <li>Verification and password-reset links expire; signing out kills the server-side session.</li>
        </ul>
      </div>
    </div>
  );
}

function AddMemberButton({ workspaceId, onAdded }: { workspaceId: string; onAdded: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/ws/${workspaceId}/members`, { email, role });
      toast(`${email} added as ${role}.`, "success");
      setOpen(false);
      setEmail("");
      await onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the member");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <UserPlus size={14} /> Add member
      </Button>
      {open && (
        <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Add member">
            <h2>Add a member</h2>
            <form onSubmit={submit} noValidate>
              <Field label="Email" hint="They need a Lexora account first. Roles: viewer reads, editor writes, admin manages members.">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </Field>
              <Field label="Role">
                <Select value={role} onChange={(e) => setRole(e.target.value)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </Select>
              </Field>
              {error && <p className="error-text">{error}</p>}
              <div className="modal-actions">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={busy}>{busy ? "Adding…" : "Add member"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function RoleSelect({ workspaceId, userId, current, onDone }: { workspaceId: string; userId: string; current: string; onDone: () => Promise<void> }) {
  const toast = useToast();
  return (
    <Select
      value={current}
      onChange={async (e) => {
        try {
          await api.patch(`/api/ws/${workspaceId}/members/${userId}`, { role: e.target.value });
          toast("Role updated.", "success");
          await onDone();
        } catch (err) {
          toast(err instanceof Error ? err.message : "Could not update the role", "error");
        }
      }}
      style={{ width: 110 }}
      aria-label="Change role"
    >
      {ROLES.map((r) => (
        <option key={r} value={r}>{r}</option>
      ))}
    </Select>
  );
}

function RemoveMemberButton({ workspaceId, userId, email, onDone }: { workspaceId: string; userId: string; email: string; onDone: () => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/api/ws/${workspaceId}/members/${userId}`);
      toast(`${email} removed from the workspace.`);
      setConfirm(false);
      await onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not remove the member", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="ghost" size="sm" className="btn-icon" onClick={() => setConfirm(true)} aria-label={`Remove ${email}`}>
        <Trash2 size={14} />
      </Button>
      {confirm && (
        <ConfirmDialog
          title={`Remove ${email}?`}
          body="They will immediately lose access to this workspace. Their practice progress is kept in case they rejoin."
          confirmLabel="Remove member"
          danger
          onConfirm={remove}
          onCancel={() => setConfirm(false)}
          busy={busy}
        />
      )}
    </>
  );
}

/* --------------------------------- activity log ------------------------------- */

export function ActivityLog({ workspace }: { workspace: Workspace }) {
  const [data, setData] = useState<{ total: number; page: number; pageSize: number; items: Array<{ id: string; action: string; resourceType: string; createdAt: string; metadata: Record<string, unknown> }> } | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    document.title = "Activity Log — Lexora";
  }, []);

  useEffect(() => {
    void api.get<typeof data>(`/api/ws/${workspace.id}/activity?page=${page}&pageSize=25`).then((r) => r && setData(r));
  }, [workspace.id, page]);

  if (!data) return <LoadingScreen />;
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div>
      <PageHeader title="Activity Log" subtitle="An honest record of everything that happened in this workspace." />
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((a) => (
                <tr key={a.id}>
                  <td className="bilingual" style={{ whiteSpace: "nowrap" }}>{formatWhen(a.createdAt)}</td>
                  <td><Badge tone="navy">{a.action}</Badge></td>
                  <td className="bilingual">{Object.entries(a.metadata).map(([k, v]) => `${k}: ${String(v)}`).join(" · ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {totalPages > 1 && (
        <div className="pagination">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span>Page {data.page} of {totalPages} · {data.total} events</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------- settings --------------------------------- */

export function Settings({ workspace }: { workspace: Workspace }) {
  const { workspaces, refresh, user } = useSession();
  const role = workspaces.find((w) => w.id === workspace.id)?.role ?? workspace.role;
  const toast = useToast();

  useEffect(() => {
    document.title = "Settings — Lexora";
  }, []);

  return (
    <div>
      <PageHeader title="Settings" subtitle={`Workspace "${workspace.name}" · you are the ${role}.`} />
      <WorkspaceSettings workspace={workspace} role={role} onChanged={refresh} />
      <AccountSettings user={user} onChanged={refresh} />
    </div>
  );
}

function WorkspaceSettings({ workspace, role, onChanged }: { workspace: Workspace; role: string; onChanged: () => Promise<void> }) {
  const [name, setName] = useState(workspace.name);
  const [busy, setBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();
  const canRename = role === "owner" || role === "admin";
  const isOwner = role === "owner";

  const rename = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch(`/api/ws/${workspace.id}`, { name });
      toast("Workspace renamed.", "success");
      await onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Rename failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const destroy = async () => {
    setBusy(true);
    try {
      await api.del(`/api/ws/${workspace.id}`);
      toast("Workspace and all its data were deleted.", "success");
      localStorage.removeItem("lexora.activeWorkspace");
      await onChanged();
      navigate("/app/welcome");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Delete failed", "error");
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3>Workspace</h3>
      {canRename ? (
        <form onSubmit={rename} className="form-row" noValidate>
          <Field label="Workspace name">
            <Input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={80} required />
          </Field>
          <div style={{ alignSelf: "end" }}>
            <Button type="submit" disabled={busy || name.trim() === workspace.name}>Save name</Button>
          </div>
        </form>
      ) : (
        <p className="bilingual">Only an admin or the owner can rename the workspace.</p>
      )}

      <div style={{ borderTop: "1px solid var(--border)", marginTop: 18, paddingTop: 18 }}>
        <h3 style={{ color: "var(--danger)" }}>Danger zone</h3>
        {isOwner ? (
          <>
            <p className="bilingual">Deleting the workspace permanently removes its dictionary, language, versions and history. This cannot be undone.</p>
            <Button variant="danger" onClick={() => setDeleteConfirm(true)}>
              <ShieldAlert size={15} /> Delete this workspace
            </Button>
            {deleteConfirm && (
              <ConfirmDialog
                title={`Delete "${workspace.name}"?`}
                body="Everything in this workspace — dictionary, generated language, all versions, practice data and activity history — will be permanently deleted."
                confirmLabel="Delete forever"
                danger
                onConfirm={destroy}
                onCancel={() => setDeleteConfirm(false)}
                busy={busy}
              />
            )}
          </>
        ) : (
          <p className="bilingual">Only the workspace owner can delete it.</p>
        )}
      </div>
    </div>
  );
}

function AccountSettings({ user }: { user: PublicUser | null; onChanged: () => Promise<void> }) {
  const { refresh } = useSession();
  const blocks = useBlocksAuth();
  const navigate = useNavigate();

  // Ends the Blocks IAM session -- with SSO as the only sign-in, an alive IAM
  // session would make sign-out a one-click undo. There is no app-side session
  // cookie anymore; /me just reads the caller's token. (Account deletion is an
  // IAM-admin concern now: the app keeps no user records of its own.)
  const signOut = async () => {
    await blocks.logout();
    await refresh();
    navigate("/login");
  };

  if (!user) return null;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-title">
        <h3>Your account</h3>
        <Button variant="outline" size="sm" onClick={() => void signOut()}>Sign out</Button>
      </div>
      <p className="bilingual">
        {user.email} · signed in with SELISE Blocks SSO · joined {new Date(user.createdAt).toLocaleDateString()}
      </p>
    </div>
  );
}
