import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Download, Moon, ShieldAlert, Sun, Trash2, UserPlus } from "lucide-react";
import { api, downloadFile, type WorkspaceSummary } from "../api.js";
import { describeApiError } from "../errors.js";
import { useSession } from "../state.js";
import { toast } from "sonner";
import { saveTheme, type Theme } from "../theme.js";
import { Badge, Button, ConfirmDialog, EmptyState, Field, HonestNote, Input, LoadingScreen, Modal, PageHeader, Select, Stat } from "../ui.js";
import { formatWhen } from "./Dashboard.js";
import { t } from "../i18n/index.js";

type Workspace = { id: string; name: string; role: "owner" | "admin" | "editor" | "viewer" };

// TODO(iam-roles): the ROLES list and every canManage/canRename/isOwner check
// below run on the local workspace ladder, not IAM roles (src/core/types.ts)
const ROLES = ["viewer", "editor", "admin"] as const;

const ROLE_NOTES: Record<string, string> = {
  owner: "workspace.role_note.owner",
  admin: "workspace.role_note.admin",
  editor: "workspace.role_note.editor",
  viewer: "workspace.role_note.viewer"
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
      <PageHeader title={t("workspace.security.title")} subtitle={t("workspace.security.subtitle")} />

      <HonestNote>
        {t("workspace.security.honest_prefix")} <strong>{t("workspace.security.honest_strong")}</strong>
        {t("workspace.security.honest_suffix")}
      </HonestNote>

      <div className="metrics">
        <Stat value={security?.members ?? members.length} label={t("workspace.security.stat_members")} />
        <Stat value={security?.exportEvents ?? 0} label={t("workspace.security.stat_exports")} />
        <Stat value={security?.generationRuns ?? 0} label={t("workspace.security.stat_generations")} />
        <Stat value={t("workspace.security.stat_residency_value")} label={t("workspace.security.stat_residency")} />
      </div>

      <div className="card">
        <div className="card-title">
          <h3>{t("workspace.security.members_title")}</h3>
          {canManage && <AddMemberButton workspaceId={workspace.id} onAdded={load} />}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t("workspace.members.column_email")}</th>
                <th>{t("workspace.members.column_role")}</th>
                <th>{t("workspace.members.column_since")}</th>
                {canManage && <th>{t("workspace.members.column_actions")}</th>}
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
                    <div className="bilingual" style={{ fontSize: 12 }}>{ROLE_NOTES[m.role] ? t(ROLE_NOTES[m.role]) : ""}</div>
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
        <h3>{t("workspace.security.how_title")}</h3>
        <ul style={{ margin: 0, paddingLeft: 20, color: "var(--text-muted)", fontSize: 14, lineHeight: 1.8 }}>
          <li>{t("workspace.security.how_1")}</li>
          <li>{t("workspace.security.how_2")}</li>
          <li>{t("workspace.security.how_3")}</li>
          <li>{t("workspace.security.how_4")}</li>
          <li>{t("workspace.security.how_5")}</li>
          <li>{t("workspace.security.how_6")}</li>
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
      toast.success(t("workspace.members.add_toast", { email, role }));
      setOpen(false);
      setEmail("");
      await onAdded();
    } catch (err) {
      setError(describeApiError(err, t("workspace.members.add_error")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <UserPlus size={14} /> {t("workspace.members.add")}
      </Button>
      {open && (
        <Modal title={t("workspace.members.add_title")} onClose={() => setOpen(false)}>
          <form onSubmit={submit} noValidate>
            <Field label={t("workspace.members.email_label")} hint={t("workspace.members.email_hint")}>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label={t("workspace.members.role_label")}>
              <Select value={role} onChange={(v) => setRole(v)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </Select>
            </Field>
            {error && <p className="error-text">{error}</p>}
            <div className="modal-actions">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
              <Button type="submit" disabled={busy}>{busy ? t("workspace.members.adding") : t("workspace.members.add_button")}</Button>
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
          toast.success(t("workspace.members.role_toast"));
          await onDone();
        } catch (err) {
          toast.error(describeApiError(err, t("workspace.members.role_error")));
        }
      }}
      style={{ width: 110 }}
      aria-label={t("workspace.members.role_aria")}
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
      toast(t("workspace.members.remove_toast", { email }));
      setConfirm(false);
      await onDone();
    } catch (err) {
      toast.error(describeApiError(err, t("workspace.members.remove_error")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="ghost" size="sm" className="btn-icon" onClick={() => setConfirm(true)} aria-label={t("workspace.members.remove_aria", { email })}>
        <Trash2 size={14} />
      </Button>
      {confirm && (
        <ConfirmDialog
          title={t("workspace.members.remove_title", { email })}
          body={t("workspace.members.remove_body")}
          confirmLabel={t("workspace.members.remove_confirm")}
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

  if (data.items.length === 0) {
    return (
      <div>
        <PageHeader title={t("workspace.activity.title")} subtitle={t("workspace.activity.subtitle")} />
        <EmptyState
          title={t("workspace.activity.empty_title")}
          body={t("workspace.activity.empty_body")}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t("workspace.activity.title")} subtitle={t("workspace.activity.subtitle")} />
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t("workspace.activity.column_when")}</th>
                <th>{t("workspace.activity.column_event")}</th>
                <th>{t("workspace.activity.column_details")}</th>
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
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("common.previous")}</Button>
          <span>{t("workspace.activity.page_line", { page: data.page, total: totalPages, count: data.total })}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>{t("common.next")}</Button>
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
      <PageHeader title={t("workspace.settings.title")} subtitle={t("workspace.settings.subtitle", { name: workspace.name, role })} />
      <WorkspaceSettings workspace={workspace} role={role} wordCount={summary?.wordCount} onChanged={refresh} />
      <AppearanceSettings />
      <BackupSettings workspace={workspace} role={role} />
      <DangerZone workspace={workspace} role={role} onChanged={refresh} />
    </div>
  );
}

/* Full-workspace export (design.md §14): today's only backup mechanism --
   the gateway keeps no point-in-time copies, so this card says so plainly. */
function BackupSettings({ workspace, role }: { workspace: Workspace; role: string }) {
  const canExport = role === "owner" || role === "admin";
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      await downloadFile(`/api/ws/${workspace.id}/export/all`);
      toast.success(t("workspace.settings.backup_toast"));
    } catch (err) {
      toast.error(describeApiError(err, t("workspace.settings.export_failed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>{t("workspace.settings.backup_title")}</h3>
      <p className="bilingual">
        {t("workspace.settings.backup_body")}
      </p>
      {canExport ? (
        <Button variant="outline" disabled={busy} onClick={() => void download()}>
          <Download size={15} /> {t("workspace.settings.backup_download")}
        </Button>
      ) : (
        <p className="bilingual" style={{ margin: 0 }}>
          {t("workspace.settings.backup_viewer_note")}
        </p>
      )}
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
      toast.success(t("workspace.settings.rename_toast"));
      await onChanged();
    } catch (err) {
      toast.error(describeApiError(err, t("workspace.settings.rename_error")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-title">
        <h3>{t("workspace.settings.workspace_title")}</h3>
        <div className="ws-meta">
          <Badge tone={ROLE_TONE[role] ?? "gray"}>{role}</Badge>
          {typeof wordCount === "number" && <span className="bilingual">{t("workspace.settings.words", { count: wordCount })}</span>}
        </div>
      </div>
      {canRename ? (
        <form onSubmit={rename} className="rename-row" noValidate>
          <Field label={t("workspace.settings.name_label")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={80} required />
          </Field>
          <Button type="submit" disabled={busy || name.trim() === workspace.name}>{t("workspace.settings.save_name")}</Button>
        </form>
      ) : (
        <p className="bilingual">{t("workspace.settings.rename_note")}</p>
      )}
      <p className="bilingual" style={{ marginTop: 16, marginBottom: 0 }}>
        {t("workspace.settings.where_note")} <Link to="/app/security">{t("app.nav.security_access")}</Link>
        {t("workspace.settings.where_note_photo")} <Link to="/app/profile">{t("app.menu.profile")}</Link>.
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
      <h3>{t("workspace.settings.appearance_title")}</h3>
      <p className="bilingual">{t("workspace.settings.appearance_body")}</p>
      <div className="seg" role="radiogroup" aria-label={t("workspace.settings.theme_aria")}>
        <button type="button" role="radio" aria-checked={theme === "light"} className={theme === "light" ? "on" : ""} onClick={() => pick("light")}>
          <Sun size={14} /> {t("workspace.settings.theme_light")}
        </button>
        <button type="button" role="radio" aria-checked={theme === "dark"} className={theme === "dark" ? "on" : ""} onClick={() => pick("dark")}>
          <Moon size={14} /> {t("workspace.settings.theme_dark")}
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
      toast.success(t("workspace.danger.deleted_toast"));
      localStorage.removeItem("lexora.activeWorkspace");
      await onChanged();
      navigate("/app/welcome");
    } catch (err) {
      toast.error(describeApiError(err, t("workspace.danger.delete_error")));
      setBusy(false);
    }
  };

  return (
    <div className="card card-danger" style={{ marginTop: 16 }}>
      <h3 style={{ color: "var(--danger)" }}>{t("workspace.danger.title")}</h3>
      {isOwner ? (
        <>
          <p className="bilingual">{t("workspace.danger.body")}</p>
          <Button variant="danger" onClick={() => setConfirming(true)}>
            <ShieldAlert size={15} /> {t("workspace.danger.delete_button")}
          </Button>
          {confirming && (
            <ConfirmDialog
              title={t("workspace.danger.confirm_title", { name: workspace.name })}
              body={t("workspace.danger.confirm_body")}
              confirmLabel={t("workspace.danger.confirm_label")}
              danger
              onConfirm={destroy}
              onCancel={() => setConfirming(false)}
              busy={busy}
            />
          )}
        </>
      ) : (
        <p className="bilingual">{t("workspace.danger.viewer_note")}</p>
      )}
    </div>
  );
}
