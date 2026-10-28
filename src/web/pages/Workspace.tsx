import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Moon, ShieldAlert, Sun, Trash2, UserPlus } from "lucide-react";
import { api, type WorkspaceSummary } from "../api.js";
import { useSession } from "../state.js";
import { toast } from "sonner";
import { saveTheme, type Theme } from "../theme.js";
import { Badge, Button, ConfirmDialog, Field, HonestNote, Input, LoadingScreen, Modal, PageHeader, Select, Stat } from "../ui.js";
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
    document.title = "Security & Access · Lexora";
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
        encryption</strong>: anyone who learns it can read it. Never use it to protect credentials or personal data.
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
                {canManage && <th>Actions</th>}
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
          <li>Workspace data lives in the SELISE Blocks Data Gateway; every call uses your own signed-in identity.</li>
          <li>Membership is checked on every workspace action, so data stays inside the team.</li>
          <li>Sign-in runs through your organisation's SELISE Blocks SSO; Lexora never stores passwords.</li>
          <li>Exports, imports and generations are recorded in the Activity Log.</li>
          <li>Avatar files are stored privately; the browser only ever receives short-lived access links.</li>
          <li>Signing out ends your Blocks session.</li>
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/ws/${workspaceId}/members`, { email, role });
      toast.success(`${email} added as ${role}.`);
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
        <Modal title="Add a member" onClose={() => setOpen(false)}>
          <form onSubmit={submit} noValidate>
            <Field label="Email" hint="They need a Lexora account first. Roles: viewer reads, editor writes, admin manages members.">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Role">
              <Select value={role} onChange={(v) => setRole(v)}>
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
        </Modal>
      )}
    </>
  );
}

function RoleSelect({ workspaceId, userId, current, onDone }: { workspaceId: string; userId: string; current: string; onDone: () => Promise<void> }) {
  return (
    <Select
      value={current}
      onChange={async (v) => {
        try {
          await api.patch(`/api/ws/${workspaceId}/members/${userId}`, { role: v });
          toast.success("Role updated.");
          await onDone();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not update the role");
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

  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/api/ws/${workspaceId}/members/${userId}`);
      toast(`${email} removed from the workspace.`);
      setConfirm(false);
      await onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove the member");
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
    document.title = "Activity Log · Lexora";
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
                  <td className="bilingual">{Object.entries(a.metadata).map(([k, v]) => `${k}: ${String(v)}`).join(" · ") || ""}</td>
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
  const { workspaces, refresh } = useSession();
  const role = workspaces.find((w) => w.id === workspace.id)?.role ?? workspace.role;
  const summary = workspaces.find((w) => w.id === workspace.id);

  useEffect(() => {
    document.title = "Settings · Lexora";
  }, []);

  return (
    <div>
      <PageHeader title="Settings" subtitle={`Workspace "${workspace.name}" · you are the ${role}.`} />
      <WorkspaceSettings workspace={workspace} role={role} wordCount={summary?.wordCount} onChanged={refresh} />
      <AppearanceSettings />
      <DangerZone workspace={workspace} role={role} onChanged={refresh} />
    </div>
  );
}

const ROLE_TONE: Record<string, "violet" | "teal" | "green" | "gray"> = { owner: "violet", admin: "teal", editor: "green", viewer: "gray" };

function WorkspaceSettings({ workspace, role, wordCount, onChanged }: { workspace: Workspace; role: string; wordCount?: number; onChanged: () => Promise<void> }) {
  const [name, setName] = useState(workspace.name);
  const [busy, setBusy] = useState(false);
  const canRename = role === "owner" || role === "admin";

  const rename = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch(`/api/ws/${workspace.id}`, { name });
      toast.success("Workspace renamed.");
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-title">
        <h3>Workspace</h3>
        <div className="ws-meta">
          <Badge tone={ROLE_TONE[role] ?? "gray"}>{role}</Badge>
          {typeof wordCount === "number" && <span className="bilingual">{wordCount} words</span>}
        </div>
      </div>
      {canRename ? (
        <form onSubmit={rename} className="rename-row" noValidate>
          <Field label="Workspace name">
            <Input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={80} required />
          </Field>
          <Button type="submit" disabled={busy || name.trim() === workspace.name}>Save name</Button>
        </form>
      ) : (
        <p className="bilingual">Only an admin or the owner can rename the workspace.</p>
      )}
      <p className="bilingual" style={{ marginTop: 16, marginBottom: 0 }}>
        Members and roles live in <Link to="/app/security">Security &amp; Access</Link>, your photo and name in{" "}
        <Link to="/app/profile">Profile</Link>.
      </p>
    </div>
  );
}

/* Light/dark control, synced with the top-bar toggle: saveTheme() broadcasts
   the THEME_EVENT and AppShell listens. */
function AppearanceSettings() {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"));
  const pick = (next: Theme) => {
    setTheme(next);
    saveTheme(next);
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>Appearance</h3>
      <p className="bilingual">Light or dark, everywhere in the app; same switch as the one in the top bar.</p>
      <div className="seg" role="radiogroup" aria-label="Theme">
        <button type="button" role="radio" aria-checked={theme === "light"} className={theme === "light" ? "on" : ""} onClick={() => pick("light")}>
          <Sun size={14} /> Light
        </button>
        <button type="button" role="radio" aria-checked={theme === "dark"} className={theme === "dark" ? "on" : ""} onClick={() => pick("dark")}>
          <Moon size={14} /> Dark
        </button>
      </div>
    </div>
  );
}

function DangerZone({ workspace, role, onChanged }: { workspace: Workspace; role: string; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const navigate = useNavigate();
  const isOwner = role === "owner";

  const destroy = async () => {
    setBusy(true);
    try {
      await api.del(`/api/ws/${workspace.id}`);
      toast.success("Workspace and all its data were deleted.");
      localStorage.removeItem("lexora.activeWorkspace");
      await onChanged();
      navigate("/app/welcome");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
      setBusy(false);
    }
  };

  return (
    <div className="card card-danger" style={{ marginTop: 16 }}>
      <h3 style={{ color: "var(--danger)" }}>Danger zone</h3>
      {isOwner ? (
        <>
          <p className="bilingual">Deleting the workspace permanently removes its dictionary, language, versions and history. This cannot be undone.</p>
          <Button variant="danger" onClick={() => setConfirming(true)}>
            <ShieldAlert size={15} /> Delete this workspace
          </Button>
          {confirming && (
            <ConfirmDialog
              title={`Delete "${workspace.name}"?`}
              body="Everything in this workspace (dictionary, generated language, all versions, practice data and activity history) will be permanently deleted."
              confirmLabel="Delete forever"
              danger
              onConfirm={destroy}
              onCancel={() => setConfirming(false)}
              busy={busy}
            />
          )}
        </>
      ) : (
        <p className="bilingual">Only the workspace owner can delete it.</p>
      )}
    </div>
  );
}
