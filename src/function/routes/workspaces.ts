import { uid, nowIso } from "../../core/db/ids.js";
import { parseBody, pageParams } from "../../core/lib/validate.js";
import {
  workspaceCreateSchema,
  workspaceUpdateSchema,
  memberAddSchema,
  memberUpdateSchema,
  avatarSchema,
  avatarUploadSchema
} from "../../shared/schemas.js";
import { badRequest, notFound } from "../../core/lib/errors.js";
import { logActivity } from "../../core/services/activity.js";
import type { WorkspaceRole } from "../../shared/schemas.js";
import type { LanguageRow } from "../../core/db/rows.js";
import type { ApiDeps, ApiRequest, ApiResponse } from "../support.js";
import { created, ok, requireWorkspace } from "../support.js";

/* Workspace domain: list/create, detail/rename/delete, dashboard, activity
   feed, members, and the security page. Ported from the Express workspace
   routes; identity is the caller's email. */

/** Storage configuration backing avatar files. Private access; only the
    function's identity touches it. */
const AVATAR_STORAGE_CONFIG = "Default";

export async function workspaceSummary(store: ApiDeps["store"], userEmail: string) {
  const rows = await store.listWorkspaceSummaries(userEmail);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    isDemo: r.is_demo === 1,
    languageName: r.language_name,
    wordCount: r.word_count,
    createdAt: r.created_at
  }));
}

/** GET me -- the SessionProvider bootstrap: identity + visible workspaces. */
export async function getMe(deps: ApiDeps, req: ApiRequest): Promise<ApiResponse> {
  return ok({
    user: {
      id: req.userEmail,
      email: req.userEmail,
      name: req.userDisplayName ?? "",
      emailVerified: true,
      createdAt: ""
    },
    workspaces: await workspaceSummary(deps.store, req.userEmail)
  });
}

/** GET me/avatar -- the caller's avatar: the Blocks Data file id plus a fresh
    short-lived download URL. The download URL is resolved HERE, with the
    function's identity, because the caller's own token carries no Data
    permissions; download URLs expire, so this is re-fetched per page load. */
export async function getAvatar(deps: ApiDeps, req: ApiRequest): Promise<ApiResponse> {
  const fileId = await deps.store.getAvatarFileId(req.userEmail);
  if (!fileId) return ok({ fileId: null, downloadUrl: null });
  try {
    const res = await deps.files.get(fileId, { configurationName: AVATAR_STORAGE_CONFIG });
    return ok({ fileId, downloadUrl: pickFileUrl(res) });
  } catch {
    return ok({ fileId, downloadUrl: null });
  }
}

/** Storage file extension per accepted image type -- presign requires a
    name with an allowed extension (blocks-data-storage skill). */
const AVATAR_EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;

/** POST me/avatar/upload-url -- pre-signed upload URL, created with the
    function's identity. Returns { uploadUrl, fileId, requiredHeaders }; the
    SPA PUTs the bytes straight to Azure (with those headers) and then PATCHes
    the pointer. Private access modifier, 5 MB cap enforced client-side. */
export async function createAvatarUploadUrl(deps: ApiDeps, req: ApiRequest): Promise<ApiResponse> {
  const body = parseBody(avatarUploadSchema, req.body);
  // Storage errors carry the gateway's own reason (BlocksApiError.message) —
  // surface it instead of the handler's blind 500 so failures diagnose themselves.
  let res: unknown;
  try {
    res = await deps.files.presignedUploadUrl({
      name: `avatar-${req.userEmail.split("@")[0]}-${Date.now()}.${AVATAR_EXTENSIONS[body.contentType]}`,
      configurationName: AVATAR_STORAGE_CONFIG,
      accessModifier: "Private",
      contentType: body.contentType
    });
  } catch (e) {
    const reason = e instanceof Error && e.message ? e.message : "unknown storage error";
    throw badRequest(`Storage presign failed: ${reason.slice(0, 300)}. Please try again.`);
  }
  const found = extractPresign(res);
  if (!found.uploadUrl || !found.fileId) {
    throw badRequest(`Storage presign failed: ${describePresignFailure(res)}. Please try again.`);
  }
  return created({ uploadUrl: found.uploadUrl, fileId: found.fileId, requiredHeaders: found.requiredHeaders ?? {} });
}

/** The presign payload has appeared top-level and nested under `data` on
    different endpoints — walk a few levels and take the fields by name,
    including the requiredHeaders the provider expects on the PUT. */
function extractPresign(res: unknown, depth = 0): {
  uploadUrl?: string;
  fileId?: string;
  requiredHeaders?: Record<string, string>;
} {
  if (!res || typeof res !== "object" || depth > 3) return {};
  const out: { uploadUrl?: string; fileId?: string; requiredHeaders?: Record<string, string> } = {};
  for (const [key, value] of Object.entries(res as Record<string, unknown>)) {
    if (typeof value === "string") {
      if ((key === "uploadUrl" || key === "preSignedUrl" || key === "url") && !out.uploadUrl) out.uploadUrl = value;
      if (key === "fileId" && !out.fileId) out.fileId = value;
    } else if (value && typeof value === "object") {
      if (key === "requiredHeaders" && !out.requiredHeaders) {
        const entries = Object.entries(value as Record<string, unknown>).flatMap(([name, v]) =>
          typeof v === "string" ? [[name, v] as const] : []
        );
        if (entries.length > 0) out.requiredHeaders = Object.fromEntries(entries);
      }
      const nested = extractPresign(value, depth + 1);
      out.uploadUrl = out.uploadUrl ?? nested.uploadUrl;
      out.fileId = out.fileId ?? nested.fileId;
      out.requiredHeaders = out.requiredHeaders ?? nested.requiredHeaders;
    }
  }
  return out;
}

/** Human-readable reason from a failed presign envelope: the gateway's own
    `errors` when isSuccess=false, otherwise the top-level keys (the envelope
    shape has drifted before) — never the signed values themselves. */
function describePresignFailure(res: unknown): string {
  if (!res || typeof res !== "object") return "empty storage response";
  const r = res as Record<string, unknown>;
  if (r.isSuccess === false && r.errors) {
    const detail = typeof r.errors === "string" ? r.errors : JSON.stringify(r.errors);
    if (detail && detail !== "{}") return detail.slice(0, 300);
  }
  const keys = Object.keys(r).join(", ");
  return `unrecognized response (keys: ${keys || "none"})`;
}

/** PATCH me/avatar -- store the file id of the caller's freshly uploaded
    avatar, trashing the previous file (best-effort). */
export async function setAvatar(deps: ApiDeps, req: ApiRequest): Promise<ApiResponse> {
  const body = parseBody(avatarSchema, req.body);
  const fileId = body.fileId.trim();
  const previousFileId = await deps.store.getAvatarFileId(req.userEmail);
  await deps.store.setAvatarFileId(req.userEmail, fileId);
  if (previousFileId && previousFileId !== fileId) {
    await deps.files.delete({ fileId: previousFileId, permanent: false }).catch(() => undefined);
  }
  return ok({ fileId });
}

/** DELETE me/avatar -- clear the pointer and trash the file (best-effort). */
export async function deleteAvatar(deps: ApiDeps, req: ApiRequest): Promise<ApiResponse> {
  const previousFileId = await deps.store.getAvatarFileId(req.userEmail);
  await deps.store.setAvatarFileId(req.userEmail, "");
  if (previousFileId) {
    await deps.files.delete({ fileId: previousFileId, permanent: false }).catch(() => undefined);
  }
  return ok({ fileId: null });
}

/** First URL-shaped field in the untyped files.get payload. */
function pickFileUrl(res: unknown): string | null {
  for (const cand of [(res as Record<string, unknown>)?.data, res]) {
    if (!cand || typeof cand !== "object") continue;
    for (const key of ["fileUrl", "downloadUrl", "url", "presignedUrl", "link"]) {
      const v = (cand as Record<string, unknown>)[key];
      if (typeof v === "string" && v) return v;
    }
  }
  return null;
}

export async function listWorkspaces(deps: ApiDeps, req: ApiRequest): Promise<ApiResponse> {
  return ok({ workspaces: await workspaceSummary(deps.store, req.userEmail) });
}

export async function createWorkspace(deps: ApiDeps, req: ApiRequest): Promise<ApiResponse> {
  const body = parseBody(workspaceCreateSchema, req.body);
  const id = uid();
  await deps.store.insertWorkspace({
    id,
    name: body.name,
    normalized_name: body.name.trim().toLowerCase(),
    owner_user_id: req.userEmail,
    is_demo: 0,
    created_at: nowIso()
  });
  await deps.store.insertMembership({
    id: uid(),
    workspace_id: id,
    user_id: req.userEmail,
    role: "owner",
    created_at: nowIso()
  });
  await logActivity(deps.store, {
    workspaceId: id,
    actorUserId: req.userEmail,
    action: "workspace.created",
    resourceType: "workspace",
    resourceId: id,
    metadata: { name: body.name }
  });
  return created({ workspace: { id, name: body.name, role: "owner" } });
}

export async function getWorkspace(deps: ApiDeps, req: ApiRequest, workspaceId: string, role: WorkspaceRole): Promise<ApiResponse> {
  const workspace = await deps.store.getWorkspace(workspaceId);
  if (!workspace) throw notFound("Workspace not found");
  return ok({
    workspace: {
      id: workspace.id,
      name: workspace.name,
      isDemo: workspace.is_demo === 1,
      role,
      createdAt: workspace.created_at
    }
  });
}

export async function renameWorkspace(deps: ApiDeps, req: ApiRequest, workspaceId: string): Promise<ApiResponse> {
  await requireWorkspace(deps, workspaceId, req.userEmail, "admin", "workspace:rename");
  const body = parseBody(workspaceUpdateSchema, req.body);
  await deps.store.renameWorkspace(workspaceId, body.name, body.name.trim().toLowerCase(), nowIso());
  await logActivity(deps.store, {
    workspaceId,
    actorUserId: req.userEmail,
    action: "workspace.renamed",
    resourceType: "workspace",
    resourceId: workspaceId,
    metadata: { name: body.name }
  });
  return ok({ message: "Workspace renamed." });
}

export async function deleteWorkspace(deps: ApiDeps, req: ApiRequest, workspaceId: string): Promise<ApiResponse> {
  await requireWorkspace(deps, workspaceId, req.userEmail, "owner");
  await deps.store.deleteWorkspace(workspaceId);
  return ok({ message: "Workspace and all its data were deleted." });
}

export async function getDashboard(deps: ApiDeps, req: ApiRequest, workspaceId: string, role: WorkspaceRole): Promise<ApiResponse> {
  const workspace = await deps.store.getWorkspace(workspaceId);
  if (!workspace) throw notFound("Workspace not found");

  const [language, wordCount, withReference, lastUpdate, preview, activity] = await Promise.all([
    deps.store.getLanguageByWorkspace(workspaceId),
    deps.store.countEntries(workspaceId),
    deps.store.countEntries(workspaceId, { withReference: true }),
    deps.store.lastEntryUpdated(workspaceId),
    deps.store.recentEntries(workspaceId, 5),
    deps.store.listActivity(workspaceId, 8, 0)
  ]);

  let profile: { nativeName?: string } = {};
  if (language) {
    try {
      profile = JSON.parse(language.profile_json) as { nativeName?: string };
    } catch {
      profile = {};
    }
  }

  return ok({
    workspace: { id: workspace.id, name: workspace.name, isDemo: workspace.is_demo === 1, role },
    language: language
      ? {
          id: language.id,
          name: language.name,
          nativeName: profile.nativeName ?? "",
          description: language.description,
          version: language.version,
          status: language.status,
          createdAt: language.created_at,
          updatedAt: language.updated_at
        }
      : null,
    metrics: {
      words: wordCount,
      grammarRules: language ? countRules(language) : 0,
      mappedPercent: wordCount > 0 ? Math.round((withReference / wordCount) * 100) : 0,
      updatedAt: lastUpdate
    },
    preview: preview.map((p) => ({
      id: p.id,
      word: p.word,
      bengaliMeaning: p.bengali_meaning,
      englishMeaning: p.english_meaning,
      partOfSpeech: p.part_of_speech,
      pronunciationGuide: p.pronunciation_guide,
      source: p.source
    })),
    activity: activity.rows.map((a) => ({
      id: a.id,
      action: a.action,
      resourceType: a.resource_type,
      createdAt: a.created_at,
      metadata: safeJson(a.metadata_json)
    }))
  });
}

export async function getActivity(deps: ApiDeps, req: ApiRequest, workspaceId: string): Promise<ApiResponse> {
  const { page, pageSize, offset } = pageParams(req.query, 25);
  const { rows, total } = await deps.store.listActivity(workspaceId, pageSize, offset);
  return ok({
    total,
    page,
    pageSize,
    items: rows.map((a) => ({
      id: a.id,
      action: a.action,
      resourceType: a.resource_type,
      resourceId: a.resource_id,
      metadata: safeJson(a.metadata_json),
      createdAt: a.created_at
    }))
  });
}

export async function listMembers(deps: ApiDeps, req: ApiRequest, workspaceId: string): Promise<ApiResponse> {
  const memberships = await deps.store.listMemberships(workspaceId);
  // user_id stores the member's email (see support.ts), so it doubles as the
  // display address -- no join against a local users table anymore.
  const members = memberships
    .map((m) => ({
      user_id: m.user_id,
      role: m.role as WorkspaceRole,
      created_at: m.created_at,
      email: m.user_id
    }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  return ok({ members });
}

export async function addMember(deps: ApiDeps, req: ApiRequest, workspaceId: string): Promise<ApiResponse> {
  await requireWorkspace(deps, workspaceId, req.userEmail, "admin", "members:manage");
  const body = parseBody(memberAddSchema, req.body);
  const email = body.email.trim().toLowerCase();
  const existing = await deps.store.getMembership(workspaceId, email);
  if (existing) throw badRequest("That person is already a member of this workspace.");
  if (body.role === "owner") throw badRequest("Ownership is not transferable in this version.");
  await deps.store.insertMembership({
    id: uid(),
    workspace_id: workspaceId,
    user_id: email,
    role: body.role,
    created_at: nowIso()
  });
  await logActivity(deps.store, {
    workspaceId,
    actorUserId: req.userEmail,
    action: "member.added",
    resourceType: "membership",
    resourceId: email,
    metadata: { role: body.role }
  });
  return created({ message: "Member added." });
}

export async function updateMember(deps: ApiDeps, req: ApiRequest, workspaceId: string, targetUserId: string): Promise<ApiResponse> {
  await requireWorkspace(deps, workspaceId, req.userEmail, "admin", "members:manage");
  const body = parseBody(memberUpdateSchema, req.body);
  const target = await deps.store.getMembership(workspaceId, targetUserId);
  if (!target) throw notFound("Member not found");
  if (target.role === "owner" || body.role === "owner") throw badRequest("Ownership is not transferable in this version.");
  await deps.store.updateMembershipRole(workspaceId, targetUserId, body.role);
  return ok({ message: "Role updated." });
}

export async function removeMember(deps: ApiDeps, req: ApiRequest, workspaceId: string, targetUserId: string): Promise<ApiResponse> {
  await requireWorkspace(deps, workspaceId, req.userEmail, "admin", "members:manage");
  const target = await deps.store.getMembership(workspaceId, targetUserId);
  if (!target) throw notFound("Member not found");
  if (target.role === "owner") throw badRequest("The workspace owner cannot be removed.");
  await deps.store.deleteMembership(workspaceId, targetUserId);
  return ok({ message: "Member removed." });
}

export async function getSecurity(deps: ApiDeps, req: ApiRequest, workspaceId: string): Promise<ApiResponse> {
  const [members, exportEvents, generationRuns] = await Promise.all([
    deps.store.listMemberships(workspaceId).then((m) => m.length),
    deps.store.countActivity(workspaceId, "dictionary.exported"),
    deps.store.countJobs(workspaceId)
  ]);
  return ok({
    members,
    exportEvents,
    generationRuns,
    dataResidency: "workspace data stored in SELISE Blocks Data Gateway"
  });
}

function countRules(language: LanguageRow): number {
  try {
    const profile = JSON.parse(language.profile_json) as { grammarRules?: unknown[] };
    return Array.isArray(profile.grammarRules) ? profile.grammarRules.length : 0;
  } catch {
    return 0;
  }
}

function safeJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}
