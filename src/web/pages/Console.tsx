import { useCallback, useEffect, useState } from "react";
import { BlocksApiError } from "@seliseblocks/client";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { blocksClient } from "../lib/blocks/client.js";
import { switchActiveOrganization } from "../lib/blocks/auth.js";
import { useSession } from "../state.js";
import { toast } from "sonner";
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
} from "../ui.js";

/* The in-app IAM console: a directory rail (live counts, one index) beside a
   workbench that shows one section at a time. Every pane talks straight to the
   SELISE Blocks IAM directory with the signed-in user's own token -- nothing
   here is gated by Lexora; the platform's own permissions decide what a call
   is allowed to do, and a denied call surfaces the directory's answer
   verbatim. Mutations follow the platform's confirm discipline: build the
   change in the form, review the summary, fire the call on an explicit
   confirm. */

type Rec = Record<string, unknown>;

/** The IAM SDK is deliberately loosely typed -- pull the items array out of
    whichever envelope shape this endpoint answered with. List endpoints
    return `{ data: T[] }` (some nested ones use `{ data: { items: [] } }`). */
function itemsOf(res: unknown, keys: string[] = ["items"]): Rec[] {
  const r = (res ?? {}) as Rec;
  const data = (r.data ?? r) as Rec;
  if (Array.isArray(data)) return data as Rec[];
  for (const key of keys) {
    const v = data[key];
    if (Array.isArray(v)) return v as Rec[];
  }
  return [];
}

function reason(err: unknown, fallback: string): string {
  if (err instanceof BlocksApiError) {
    const body = err.body as Rec | undefined;
    const detail = body ? JSON.stringify(body) : "";
    return (err.message || detail || fallback).slice(0, 300);
  }
  return err instanceof Error && err.message ? err.message : fallback;
}

/** List responses carry the unpaginated total alongside `data`; the rail's
    live counts read it off a pageSize-1 request instead of listing anything. */
function totalCountOf(res: unknown): number | null {
  const t = (res as Rec | null | undefined)?.totalCount;
  return typeof t === "number" ? t : null;
}

type RoleInfo = { itemId: string; slug: string; name: string; description: string };
type PermInfo = { itemId: string; name: string; resource: string; roles: string[] };

/** The whole permission catalog in one pageSize-500 request (IAM ignores
    pageNo, so paging is pointless; 500 covers every tenant we'll see). */
async function loadPermissionCatalog(): Promise<PermInfo[]> {
  const res = await blocksClient.iam.permissions.list({ pageNo: 1, pageSize: 500 });
  const seen = new Set<string>();
  const out: PermInfo[] = [];
  for (const p of itemsOf(res)) {
    const item = {
      itemId: String(p.itemId ?? ""),
      name: String(p.name ?? p.resource ?? ""),
      resource: String(p.resource ?? ""),
      roles: Array.isArray(p.roles) ? (p.roles as string[]) : []
    };
    if (!item.itemId || seen.has(item.itemId)) continue;
    seen.add(item.itemId);
    out.push(item);
  }
  return out;
}

function roleInfos(items: Rec[]): RoleInfo[] {
  return items
    .map((r) => ({
      itemId: String(r.itemId ?? ""),
      slug: String(r.slug ?? ""),
      name: String(r.name ?? r.slug ?? ""),
      description: String(r.description ?? "")
    }))
    .filter((r) => r.slug);
}

/** Roles the signed-in admin may grant. `assignable` is the sanctioned source,
    but it comes back empty when the admin lacks its feature permission while
    still holding mutate-roles -- fall back to the full list for that case. */
async function loadAssignableRoles(): Promise<RoleInfo[]> {
  try {
    const list = roleInfos(itemsOf(await blocksClient.iam.roles.assignable()));
    if (list.length > 0) return list;
  } catch {
    /* fall through to the full list */
  }
  const res = await blocksClient.iam.roles.list({ pageNo: 1, pageSize: 100 });
  return roleInfos(itemsOf(res));
}

/** A user record's roles arrive as an array from users.get but as an
    org-keyed object ({ default: ["clouduser"] }) from users.list. */
function rolesOf(u: Rec): string[] {
  const r = u.roles;
  if (Array.isArray(r)) return r.map(String);
  if (r && typeof r === "object") return Object.values(r as Rec).flat().map(String);
  return [];
}

/* --------------------------------- shell ------------------------------------ */

type Section = "organizations" | "roles" | "users" | "invite";

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: "organizations", label: "Organizations" },
  { id: "roles", label: "Roles" },
  { id: "users", label: "Users" },
  { id: "invite", label: "Invite" }
];

export function Console() {
  const { organizations, refresh: refreshSession } = useSession();
  const [section, setSection] = useState<Section>("users");
  const [counts, setCounts] = useState<{ roles: number | null; users: number | null }>({
    roles: null,
    users: null
  });

  useEffect(() => {
    document.title = "IAM Console · Lexora";
  }, []);

  // The rail is an index of the directory, so its counts are live: one
  // pageSize-1 list each, reading the response's totalCount. A count that
  // can't be read (no permission, transient failure) just stays blank.
  useEffect(() => {
    let alive = true;
    void blocksClient.iam.roles
      .list({ pageNo: 1, pageSize: 20 })
      .then((res) => {
        if (alive) setCounts((c) => ({ ...c, roles: totalCountOf(res) }));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const orgId = organizations[0]?.id;
  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    void blocksClient.iam.users
      .list({ pageNo: 1, pageSize: 20, filter: { organizationIds: [orgId] } })
      .then((res) => {
        if (alive) setCounts((c) => ({ ...c, users: totalCountOf(res) }));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [orgId]);

  return (
    <div>
      <PageHeader
        title="IAM Console"
        subtitle="Organizations, roles, permissions and invites — your SELISE Blocks directory, without the portal."
      />
      <p className="console-note" role="note">
        This console talks straight to your organisation's SELISE Blocks directory. What you can actually do is
        decided by your own platform permissions there — <strong>not by Lexora</strong>. A call the directory
        refuses shows its real error.
      </p>
      <div className="console">
        <nav className="console-rail" aria-label="Console sections">
          <p className="console-dir">Directory</p>
          <ul className="console-index">
            {SECTIONS.map((s) => {
              const count =
                s.id === "organizations"
                  ? organizations.length
                  : s.id === "roles"
                    ? counts.roles
                    : s.id === "users"
                      ? counts.users
                      : null;
              return (
                <li key={s.id}>
                  <button type="button" aria-current={section === s.id} onClick={() => setSection(s.id)}>
                    <span>{s.label}</span>
                    {count !== null && <span className="console-leader" aria-hidden="true" />}
                    {count !== null && <span className="console-count">{count}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="console-main">
          {section === "organizations" && <OrganizationsSection organizations={organizations} onChanged={refreshSession} />}
          {section === "roles" && <RolesSection />}
          {section === "users" && <UsersSection />}
          {section === "invite" && <InviteSection />}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- organizations ------------------------------ */

function OrganizationsSection({ organizations, onChanged }: { organizations: Array<{ id: string; name: string }>; onChanged: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState<{ id: string; name: string } | null>(null);
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (!nameOk) return;
    setBusy(true);
    setError(null);
    try {
      await blocksClient.iam.organizations.create({ name: name.trim(), description: description.trim() });
      toast.success(`Organization "${name.trim()}" created.`);
      setConfirming(false);
      setCreating(false);
      setName("");
      setDescription("");
      await onChanged();
    } catch (err) {
      setError(reason(err, "Could not create the organization"));
    } finally {
      setBusy(false);
    }
  };

  const nameOk = name.trim().length >= 2;

  const doSwitch = async () => {
    if (!switching) return;
    setBusy(true);
    try {
      await switchActiveOrganization(switching.id);
      toast.success(`Active organization is now "${switching.name}". Reloading…`);
      window.setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      setBusy(false);
      setSwitching(null);
      setError(reason(err, "This login flow did not allow switching the organization"));
    }
  };

  return (
    <section>
      <div className="console-head">
        <div>
          <h2>Organizations</h2>
          <p>Your organizations in the SELISE Blocks directory. "Make active" moves the whole session into that organization's context.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setCreating((v) => !v)}>
          <Plus size={14} /> New organization
        </Button>
      </div>

      <div className="console-pane">
        {organizations.length === 0 ? (
          <p className="bilingual" style={{ padding: 16 }}>Your account isn't listed in any organization yet.</p>
        ) : (
          organizations.map((org) => (
            <div className="console-row" key={org.id}>
              <span className="console-cell-main">{org.name}</span>
              <span className="console-cell-sub console-mono console-grow">{org.id}</span>
              <Button variant="outline" size="sm" onClick={() => setSwitching(org)}>
                Make active
              </Button>
            </div>
          ))
        )}
      </div>

      {creating && (
        <form
          className="console-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (nameOk) setConfirming(true);
          }}
        >
          <h3>New organization</h3>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={120} placeholder="e.g. Acme Logistics" />
          </Field>
          <Field label="Description (optional)">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder="What this organization is for" />
          </Field>
          <ErrorNote message={error} />
          <div className="console-actions">
            <Button type="submit" disabled={!nameOk}>
              <Plus size={14} /> Create organization
            </Button>
          </div>
        </form>
      )}

      {confirming && (
        <ConfirmDialog
          title={`Create organization "${name.trim()}"?`}
          body={`This registers a new organization in your SELISE Blocks directory${description.trim() ? ` — "${description.trim()}"` : ""}. Whether your account is added to it as a member is the directory's own policy -- if it doesn't appear in the list above after this, it was still created.`}
          confirmLabel="Create organization"
          onConfirm={create}
          onCancel={() => setConfirming(false)}
          busy={busy}
        />
      )}
      {switching && (
        <ConfirmDialog
          title={`Switch active organization to "${switching.name}"?`}
          body="The rest of your session (tokens, IAM calls) moves to that organization's context, and the app reloads. Your Lexora workspaces stay as they are."
          confirmLabel="Switch organization"
          onConfirm={doSwitch}
          onCancel={() => setSwitching(null)}
          busy={busy}
        />
      )}
    </section>
  );
}

/* ---------------------------------- roles ----------------------------------- */

function RolesSection() {
  const [roles, setRoles] = useState<RoleInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<RoleInfo | null>(null);
  const [creating, setCreating] = useState(false);

  // IAM keys roles by a URL-safe slug it does NOT derive from the name
  // (create without it answers 400 "Slug: The Slug field is required"), so
  // the form carries one: auto-filled from the name until the user edits it.
  const slugify = (v: string) =>
    v.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

  const onName = (v: string) => {
    setName(v);
    if (!slugEdited) setSlug(slugify(v));
  };

  const nameOk = name.trim().length >= 2;
  const slugOk = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await blocksClient.iam.roles.list({ pageNo: 1, pageSize: 100 });
      setRoles(roleInfos(itemsOf(res)));
    } catch (err) {
      setError(reason(err, "Could not load roles (your platform permissions may not allow listing them)"));
      setRoles([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep a sensible selection as the list loads or changes: the role the user
  // had picked if it still exists, else the first one.
  useEffect(() => {
    if (!roles) return;
    setSelected((prev) => (prev && roles.some((r) => r.itemId === prev.itemId) ? prev : roles[0] ?? null));
  }, [roles]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await blocksClient.iam.roles.create({ name: name.trim(), slug, description: description.trim() });
      toast.success(`Role "${name.trim()}" created.`);
      setConfirming(false);
      setCreating(false);
      setName("");
      setSlug("");
      setSlugEdited(false);
      setDescription("");
      await load();
    } catch (err) {
      setError(reason(err, "Could not create the role"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="console-head">
        <div>
          <h2>Roles</h2>
          <p>Named bundles of permissions. Pick a role to set what it grants — users hold access through roles or direct permissions.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setCreating((v) => !v)}>
          <Plus size={14} /> New role
        </Button>
      </div>

      <ErrorNote message={error} />
      {roles === null ? (
        <div className="console-pane"><Spinner /></div>
      ) : (
        <div className="console-pane console-split">
          <div className="console-list">
            {roles.map((role) => (
              <button
                key={role.itemId}
                type="button"
                className="console-list-item"
                aria-current={selected?.itemId === role.itemId}
                onClick={() => setSelected(role)}
              >
                <span className="console-cell-main" style={{ display: "block" }}>{role.name}</span>
                <span className="console-mono" style={{ color: "var(--text-muted)" }}>{role.slug}</span>
              </button>
            ))}
            {roles.length === 0 && <p className="bilingual" style={{ padding: 16 }}>No roles listed.</p>}
          </div>
          <div className="console-detail">
            {selected && selected.slug ? (
              <RolePermissions key={selected.slug} role={selected} />
            ) : (
              <p className="bilingual">Pick a role to see its permissions.</p>
            )}
          </div>
        </div>
      )}

      {creating && (
        <form
          className="console-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (nameOk && slugOk) setConfirming(true);
          }}
        >
          <h3>New role</h3>
          <Field label="Name">
            <Input value={name} onChange={(e) => onName(e.target.value)} minLength={2} maxLength={80} placeholder="e.g. Lexora Editor" />
          </Field>
          <Field label="Slug" hint="Stable key the directory uses to identify the role. Auto-filled from the name; edit if you need a different one.">
            <Input
              value={slug}
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(e.target.value.trim().toLowerCase());
              }}
              maxLength={60}
              placeholder="e.g. lexora-editor"
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              style={slug.length > 0 && !slugOk ? { borderColor: "var(--danger)" } : undefined}
            />
          </Field>
          <Field label="Description (optional)">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder="What this role is for" />
          </Field>
          <div className="console-actions">
            <Button type="submit" disabled={!nameOk || !slugOk}>
              <Plus size={14} /> Create role
            </Button>
          </div>
        </form>
      )}

      {confirming && (
        <ConfirmDialog
          title={`Create role "${name.trim()}"?`}
          body={`Registers a new role in the directory as "${slug}"${description.trim() ? ` — "${description.trim()}"` : ""}. It starts with no permissions; grant them below after it exists.`}
          confirmLabel="Create role"
          onConfirm={create}
          onCancel={() => setConfirming(false)}
          busy={busy}
        />
      )}
    </section>
  );
}

/** The permission picker for the selected role: checkboxes show the role's
    current set; Save computes the delta and asks for one explicit confirm. */
function RolePermissions({ role }: { role: RoleInfo }) {
  const [perms, setPerms] = useState<PermInfo[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ add: Set<string>; remove: Set<string> }>({ add: new Set(), remove: new Set() });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadPermissionCatalog()
      .then((catalog) => {
        if (alive) setPerms(catalog);
      })
      .catch((err) => {
        if (alive) setError(reason(err, "Could not load the permission catalog"));
      });
    return () => {
      alive = false;
    };
  }, []);

  const held = (p: PermInfo) =>
    pending.add.has(p.itemId) || (p.roles.includes(role.slug) && !pending.remove.has(p.itemId));

  const toggle = (p: PermInfo) => {
    setPending((prev) => {
      const nowHeld = held(p);
      const next = { add: new Set(prev.add), remove: new Set(prev.remove) };
      if (nowHeld) {
        // unchecking: a pending add is simply dropped; a stored grant becomes a removal
        if (next.add.has(p.itemId)) next.add.delete(p.itemId);
        else next.remove.add(p.itemId);
      } else {
        if (next.remove.has(p.itemId)) next.remove.delete(p.itemId);
        else next.add.add(p.itemId);
      }
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await blocksClient.iam.roles.assignPermissions({
        slug: role.slug,
        addPermissions: [...pending.add],
        removePermissions: [...pending.remove],
      });
      toast.success(`Permissions updated on "${role.name}".`);
      setConfirming(false);
      setPending({ add: new Set(), remove: new Set() });
    } catch (err) {
      setError(reason(err, "Could not update the role's permissions"));
    } finally {
      setBusy(false);
    }
  };

  if (perms === null && !error) return <p className="bilingual">Loading permissions…</p>;

  const q = search.trim().toLowerCase();
  const visible = (perms ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || p.resource.toLowerCase().includes(q));
  const adds = [...pending.add];
  const removes = [...pending.remove];
  const delta = adds.length + removes.length;

  const permName = (id: string) => perms?.find((p) => p.itemId === id)?.resource ?? id;

  return (
    <>
      <div className="console-detail-head">
        <h3>{role.name}</h3>
        <span className="console-mono" style={{ color: "var(--text-muted)" }}>{role.slug}</span>
        {perms !== null && (
          <span className="bilingual" style={{ marginLeft: "auto" }}>
            {perms.filter((p) => held(p)).length} of {perms.length} permissions
          </span>
        )}
      </div>
      {role.description && <p className="bilingual" style={{ margin: "2px 0 0" }}>{role.description}</p>}
      <ErrorNote message={error} />
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter permissions…" />
      <div className="console-picker">
        {visible.map((p) => (
          <label key={p.itemId}>
            <input type="checkbox" checked={held(p)} onChange={() => toggle(p)} />
            <span className="console-mono">{p.resource || p.name}</span>
          </label>
        ))}
        {visible.length === 0 && <p style={{ padding: "8px 12px", color: "var(--text-muted)", fontSize: 13, gridColumn: "1 / -1" }}>No permissions match.</p>}
      </div>
      <div className="console-actions">
        <Button size="sm" disabled={delta === 0} onClick={() => setConfirming(true)}>
          Save changes{delta > 0 ? ` (${delta})` : ""}
        </Button>
        {delta > 0 && (
          <span className="bilingual">
            {adds.length} to grant, {removes.length} to revoke
          </span>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          title={`Update permissions on "${role.name}"?`}
          body={
            <span style={{ display: "grid", gap: 6, textAlign: "left" }}>
              {adds.length > 0 && (
                <span>
                  <strong>Grant:</strong> {adds.map(permName).join(", ")}
                </span>
              )}
              {removes.length > 0 && (
                <span>
                  <strong>Revoke:</strong> {removes.map(permName).join(", ")}
                </span>
              )}
            </span>
          }
          confirmLabel="Apply to role"
          onConfirm={save}
          onCancel={() => setConfirming(false)}
          busy={busy}
        />
      )}
    </>
  );
}

/* --------------------------------- users ------------------------------------ */

type UserRow = { itemId: string; name: string; email: string; active: boolean; roles: string[] };

function UsersSection() {
  const { organizations } = useSession();
  const [orgId, setOrgId] = useState("");
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openUser, setOpenUser] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId && organizations[0]) setOrgId(organizations[0].id);
  }, [organizations, orgId]);

  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    const t = window.setTimeout(() => {
      void (async () => {
        setError(null);
        try {
          const res = await blocksClient.iam.users.list({
            pageNo: 1,
            pageSize: 50,
            ...(search.trim() ? { search: search.trim() } : {}),
            filter: { organizationIds: [orgId] }
          });
          if (!alive) return;
          setUsers(
            itemsOf(res)
              .map((u) => ({
                itemId: String(u.itemId ?? ""),
                name: [u.firstName, u.lastName].filter(Boolean).map(String).join(" "),
                email: String(u.email ?? ""),
                active: u.active !== false,
                roles: rolesOf(u)
              }))
              .filter((u) => u.itemId)
          );
        } catch (err) {
          if (alive) {
            setError(reason(err, "Could not load users (your platform permissions may not allow listing them)"));
            setUsers([]);
          }
        }
      })();
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [orgId, search]);

  return (
    <section>
      <div className="console-head">
        <div>
          <h2>Users</h2>
          <p>Who is in this organization, and how they hold access — roles (role-based) or direct permissions (user-based).</p>
        </div>
      </div>

      {organizations.length === 0 ? (
        <div className="console-pane">
          <p className="bilingual" style={{ padding: 16 }}>No organization on your account yet.</p>
        </div>
      ) : (
        <>
          <div className="console-toolbar">
            <Field label="Organization">
              <Select value={orgId} onChange={setOrgId} aria-label="Organization">
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Search">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or email…" />
            </Field>
          </div>
          <ErrorNote message={error} />
          {users === null ? (
            <div className="console-pane"><Spinner /></div>
          ) : (
            <div className="console-pane">
              {users.map((u) => (
                <div key={u.itemId} className="console-user">
                  <button
                    type="button"
                    className="console-rowbtn"
                    onClick={() => setOpenUser(openUser === u.itemId ? null : u.itemId)}
                    aria-expanded={openUser === u.itemId}
                  >
                    {openUser === u.itemId ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    <span className="console-cell-main console-grow">{u.name || u.email}</span>
                    <span className="console-cell-sub">{u.email}</span>
                    {!u.active && <Badge tone="amber">inactive</Badge>}
                    {u.roles.map((slug) => (
                      <Badge key={slug} tone="navy">{slug}</Badge>
                    ))}
                  </button>
                  {openUser === u.itemId && (
                    <div className="console-user-body">
                      <UserAccess userId={u.itemId} orgId={orgId} />
                    </div>
                  )}
                </div>
              ))}
              {users.length === 0 && <p className="bilingual" style={{ padding: 16 }}>No users found.</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** One user's access editor. IAM's grant endpoint REPLACES every list it
    receives, so the confirm shows the complete final sets and the request
    sends exactly those; lists that didn't change are omitted (kept as-is).
    Permissions are stored as itemIds but reported back as resource strings,
    so current state is keyed by resource and mapped through the catalog on
    save. */
function UserAccess({ userId, orgId }: { userId: string; orgId: string }) {
  const [current, setCurrent] = useState<{ roles: string[]; permissions: string[] } | null>(null);
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [perms, setPerms] = useState<PermInfo[]>([]);
  const [permSearch, setPermSearch] = useState("");
  const [pendingRoles, setPendingRoles] = useState<Set<string>>(new Set());
  const [pendingPerms, setPendingPerms] = useState<Set<string>>(new Set()); // resource strings
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await blocksClient.iam.users.get(userId, { organizationId: orgId });
    const u = ((res as Record<string, unknown>)?.data ?? res ?? {}) as Rec;
    const state = {
      roles: Array.isArray(u.roles) ? u.roles.map(String) : [],
      permissions: Array.isArray(u.permissions) ? u.permissions.map(String) : []
    };
    setCurrent(state);
    setPendingRoles(new Set(state.roles));
    setPendingPerms(new Set(state.permissions));
  }, [userId, orgId]);

  useEffect(() => {
    let alive = true;
    void load().catch((err) => {
      if (alive) setError(reason(err, "Could not load this user's access"));
    });
    void loadAssignableRoles().then((list) => {
      if (alive) setRoles(list);
    }).catch(() => undefined);
    void loadPermissionCatalog().then((catalog) => {
      if (alive) setPerms(catalog);
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [load]);

  if (!current && !error) return <p className="bilingual">Loading access…</p>;

  const toggleRole = (slug: string) =>
    setPendingRoles((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  const togglePerm = (resource: string) =>
    setPendingPerms((prev) => {
      const next = new Set(prev);
      if (next.has(resource)) next.delete(resource);
      else next.add(resource);
      return next;
    });

  const rolesAdded = [...pendingRoles].filter((s) => !current?.roles.includes(s));
  const rolesRemoved = (current?.roles ?? []).filter((s) => !pendingRoles.has(s));
  const permsAdded = [...pendingPerms].filter((r) => !current?.permissions.includes(r));
  const permsRemoved = (current?.permissions ?? []).filter((r) => !pendingPerms.has(r));
  const dirty = rolesAdded.length + rolesRemoved.length + permsAdded.length + permsRemoved.length > 0;

  const catalogByResource = new Map(perms.map((p) => [p.resource, p]));
  const permLabel = (resource: string) => catalogByResource.get(resource)?.resource ?? resource;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: Rec = { userId, organizationId: orgId };
      if (rolesAdded.length > 0 || rolesRemoved.length > 0) body.roles = [...pendingRoles];
      if (permsAdded.length > 0 || permsRemoved.length > 0) {
        // catalog-known grants go by itemId; anything outside the catalog
        // (custom permission) rides along as its resource string
        body.permissions = [...pendingPerms].map((r) => catalogByResource.get(r)?.itemId ?? r);
      }
      await blocksClient.iam.users.updateAccess(body);
      toast.success("Access updated.");
      setConfirming(false);
      await load();
    } catch (err) {
      setError(reason(err, "The directory refused this access change"));
    } finally {
      setBusy(false);
    }
  };

  const q = permSearch.trim().toLowerCase();
  const visiblePerms = perms.filter((p) => !q || p.resource.toLowerCase().includes(q));

  return (
    <>
      <ErrorNote message={error} />
      <div className="console-access">
        <div>
          <h4>Roles (role-based)</h4>
          {roles.length === 0 ? (
            <p className="bilingual">No roles listed for you.</p>
          ) : (
            <div className="console-checks">
              {roles.map((r) => (
                <label key={r.slug}>
                  <input type="checkbox" checked={pendingRoles.has(r.slug)} onChange={() => toggleRole(r.slug)} />
                  <span>
                    {r.name}{" "}
                    <span className="console-mono" style={{ color: "var(--text-muted)", fontSize: 11 }}>{r.slug}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div>
          <h4>Direct permissions (user-based)</h4>
          <Input value={permSearch} onChange={(e) => setPermSearch(e.target.value)} placeholder="Filter permissions…" />
          <div className="console-picker" style={{ maxHeight: 220, marginTop: 8 }}>
            {visiblePerms.map((p) => (
              <label key={p.itemId}>
                <input type="checkbox" checked={pendingPerms.has(p.resource)} onChange={() => togglePerm(p.resource)} />
                <span className="console-mono">{p.resource || p.name}</span>
              </label>
            ))}
            {perms.length === 0 && (
              <p style={{ padding: "8px 12px", color: "var(--text-muted)", fontSize: 13, gridColumn: "1 / -1" }}>
                Permission catalog unavailable.
              </p>
            )}
          </div>
          {current && current.permissions.some((r) => !catalogByResource.has(r)) && (
            <p className="bilingual" style={{ margin: "8px 0 0" }}>
              This user holds permissions outside the catalog; they are kept as-is unless you change the list.
            </p>
          )}
        </div>
      </div>
      <div className="console-actions">
        <Button size="sm" disabled={!dirty} onClick={() => setConfirming(true)}>
          Save access{dirty ? ` (${rolesAdded.length + rolesRemoved.length + permsAdded.length + permsRemoved.length})` : ""}
        </Button>
      </div>

      {confirming && (
        <ConfirmDialog
          title="Update this user's access?"
          body={
            <span style={{ display: "grid", gap: 6, textAlign: "left" }}>
              {rolesAdded.length + rolesRemoved.length > 0 && (
                <span>
                  <strong>Roles become:</strong> {[...pendingRoles].join(", ") || "(none)"}
                  {rolesRemoved.length > 0 && <> (removing: {rolesRemoved.join(", ")})</>}
                </span>
              )}
              {permsAdded.length + permsRemoved.length > 0 && (
                <span>
                  <strong>Direct permissions become:</strong> {pendingPerms.size}
                  {permsRemoved.length > 0 && <> (removing: {permsRemoved.map(permLabel).join(", ")})</>}
                  {permsAdded.length > 0 && <> (adding: {permsAdded.map(permLabel).join(", ")})</>}
                </span>
              )}
              {rolesAdded.length + rolesRemoved.length + permsAdded.length + permsRemoved.length === 0 && (
                <span>No changes.</span>
              )}
            </span>
          }
          confirmLabel="Apply access"
          onConfirm={save}
          onCancel={() => setConfirming(false)}
          busy={busy}
        />
      )}
    </>
  );
}

/* ------------------------------ invite a user ------------------------------- */

function InviteSection() {
  const { organizations } = useSession();
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [orgId, setOrgId] = useState("");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [roleSlugs, setRoleSlugs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [emailFree, setEmailFree] = useState<boolean | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [invited, setInvited] = useState<Array<{ email: string; org: string }>>([]);

  useEffect(() => {
    let alive = true;
    void loadAssignableRoles()
      .then((list) => {
        if (alive) setRoles(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!orgId && organizations[0]) setOrgId(organizations[0].id);
  }, [organizations, orgId]);

  useEffect(() => {
    setEmailFree(null);
    if (!/.+@.+\..+/.test(email.trim())) return;
    let alive = true;
    const t = window.setTimeout(() => {
      void blocksClient.iam.users
        .emailAvailable({ email: email.trim() })
        .then((res: unknown) => {
          if (!alive) return;
          const r = (res ?? {}) as Rec;
          const data = (r.data ?? r) as Rec;
          setEmailFree(data.isAvailable === undefined ? null : Boolean(data.isAvailable));
        })
        .catch(() => undefined);
    }, 400);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [email]);

  const invite = async () => {
    setBusy(true);
    setError(null);
    try {
      await blocksClient.iam.users.create({
        email: email.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        roles: roleSlugs,
        organizationId: orgId,
      });
      const orgName = organizations.find((o) => o.id === orgId)?.name ?? orgId;
      toast.success(`${email.trim()} invited to ${orgName}.`);
      setInvited((prev) => [{ email: email.trim(), org: orgName }, ...prev]);
      setConfirming(false);
      setEmail("");
      setFirstName("");
      setLastName("");
      setRoleSlugs([]);
    } catch (err) {
      setError(reason(err, "The directory refused this invite"));
    } finally {
      setBusy(false);
    }
  };

  const valid = /.+@.+\..+/.test(email.trim()) && !!orgId && firstName.trim().length > 0;
  const roleName = (slug: string) => roles.find((r) => r.slug === slug)?.name ?? slug;

  return (
    <section>
      <div className="console-head">
        <div>
          <h2>Invite</h2>
          <p>Provisions the person in your directory and gives them their roles inside the chosen organization.</p>
        </div>
      </div>

      <div className="console-invite">
        <form
          className="console-form"
          style={{ marginTop: 0 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) setConfirming(true);
          }}
        >
          <Field label="Organization">
            <Select value={orgId} onChange={setOrgId} aria-label="Organization">
              {organizations.length === 0 && <option value="">(no organizations on your account)</option>}
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </Select>
          </Field>
          <Field
            label="Email"
            hint={emailFree === false ? "Already taken in this project." : emailFree === true ? "Available." : undefined}
          >
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="person@company.com" />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="First name">
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={80} />
            </Field>
            <Field label="Last name">
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={80} />
            </Field>
          </div>
          <Field label="Roles" hint="Only roles you're allowed to assign are listed.">
            {roles.length === 0 ? (
              <p className="bilingual" style={{ margin: 0 }}>
                No assignable roles listed for you; the invite will use the directory's defaults.
              </p>
            ) : (
              <div className="console-checks" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
                {roles.map((r) => (
                  <label key={r.slug}>
                    <input
                      type="checkbox"
                      checked={roleSlugs.includes(r.slug)}
                      onChange={() =>
                        setRoleSlugs((prev) => (prev.includes(r.slug) ? prev.filter((s) => s !== r.slug) : [...prev, r.slug]))
                      }
                    />
                    <span>{r.name}</span>
                  </label>
                ))}
              </div>
            )}
          </Field>
          <ErrorNote message={error} />
          <div className="console-actions">
            <Button type="submit" disabled={!valid}>
              Send invite
            </Button>
          </div>
        </form>

        <div>
          <h4 style={{ margin: "0 0 10px", fontSize: 14 }}>Invited this session</h4>
          {invited.length === 0 ? (
            <p className="bilingual" style={{ margin: 0 }}>
              Nobody yet. Invites you send from here are listed as they go out.
            </p>
          ) : (
            <ul className="console-invite-log">
              {invited.map((i, idx) => (
                <li key={idx}>
                  <span className="console-cell-main" style={{ fontSize: 13.5 }}>{i.email}</span>
                  <span className="bilingual">to {i.org}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {confirming && (
        <ConfirmDialog
          title={`Invite ${email.trim()}?`}
          body={`Creates the account in "${organizations.find((o) => o.id === orgId)?.name ?? orgId}"${roleSlugs.length > 0 ? ` with roles: ${roleSlugs.map(roleName).join(", ")}` : " with the directory's default roles"}.`}
          confirmLabel="Send invite"
          onConfirm={invite}
          onCancel={() => setConfirming(false)}
          busy={busy}
        />
      )}
    </section>
  );
}
