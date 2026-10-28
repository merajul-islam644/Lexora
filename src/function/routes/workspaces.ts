import { uid, nowIso } from "../../core/db/ids.js";
import { parseBody, pageParams } from "../../core/lib/validate.js";
import {
  workspaceCreateSchema,
  workspaceUpdateSchema,
  memberAddSchema,
  memberUpdateSchema
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
    user: { id: req.userEmail, email: req.userEmail, emailVerified: true, createdAt: "" },
    workspaces: await workspaceSummary(deps.store, req.userEmail)
  });
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
