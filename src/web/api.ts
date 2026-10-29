/* The SPA's data layer. Everything -- schema reads/writes AND avatar file
 * storage -- goes STRAIGHT to the SELISE Blocks APIs through the SDK
 * (@seliseblocks/client) with the signed-in user's own token. There is no
 * backend of ours at all: data hits the Data Gateway, avatar presign,
 * short-lived download URLs and file trash hit Blocks Data Storage.
 *
 * Domain logic (tenant guard, permissions, import/export, the practice SRS,
 * the generation runner) runs in the browser against the same DataStore seam
 * (core/db/blocksStore). The old JSON error contract
 * { error: { code, message, details } } is kept as ApiError, so pages see
 * exactly what they always did. */

import { BlocksApiError } from "@seliseblocks/client";
import { blocksClient } from "./lib/blocks/client.js";
import { blocksStore } from "../core/db/blocksStore.js";
import type { DataStore } from "../core/db/store.js";
import { toEntryDTO, type EntryRow, type LanguageRow } from "../core/db/rows.js";
import { uid, nowIso, normalizeWord } from "../core/db/ids.js";
import {
  HttpError,
  badRequest,
  conflict,
  forbidden,
  notFound,
  unauthorized,
} from "../core/lib/errors.js";
import { parseBody, pageParams } from "../core/lib/validate.js";
import { hasAtLeast, can, type Permission } from "../core/types.js";
import { logActivity } from "../core/services/activity.js";
import {
  parseCsv,
  gridToImportRows,
  jsonToImportRows,
  buildImportReport,
  commitImport,
  exportEntries,
  CSV_TEMPLATE_HEADERS,
} from "../core/services/importExport.js";
import {
  getLanguageForWorkspace,
  getProfile,
  translate,
} from "../core/services/translation.js";
import { suggestWord, approveSuggestedWord } from "../core/services/wordbuilder.js";
import {
  createGenerationJob,
  runGenerationJob,
  getJob,
  cancelGenerationJob,
} from "../core/services/generationRunner.js";
import {
  getPracticeQueue,
  applyReview,
  getPracticeStats,
} from "../core/services/practice.js";
import {
  workspaceCreateSchema,
  workspaceUpdateSchema,
  memberAddSchema,
  memberUpdateSchema,
  dictionaryEntrySchema,
  entryUpdateSchema,
  importPreviewSchema,
  importCommitSchema,
  generateRequestSchema,
  languageRenameSchema,
  suggestWordSchema,
  approveWordSchema,
  translateSchema,
  phrasebookAddSchema,
  practiceReviewSchema,
  avatarSchema,
  avatarUploadSchema,
  PRACTICE_MODES as SCHEMA_PRACTICE_MODES,
  type WorkspaceRole,
} from "../shared/schemas.js";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** "/api/ws/1/dictionary?q=x" -> { path: "ws/1/dictionary", query: { q: "x" } }. */
function splitPath(path: string): {
  path: string;
  query: Record<string, string | string[]>;
} {
  const noApi = path.replace(/^\/api\/?/, "");
  const [pathname, search = ""] = noApi.split("?");
  const query: Record<string, string | string[]> = {};
  for (const key of new Set(new URLSearchParams(search).keys())) {
    const all = new URLSearchParams(search).getAll(key);
    query[key] = all.length > 1 ? all : (all[0] ?? "");
  }
  return { path: pathname.replace(/^\/+/, ""), query };
}

function apiErrorFrom(status: number, body: unknown): ApiError {
  const err = (
    body as
      | { error?: { code?: string; message?: string; details?: unknown } }
      | undefined
  )?.error;
  return new ApiError(
    status,
    err?.code ?? "error",
    err?.message ?? `Request failed (${status})`,
    err?.details,
  );
}

/* ------------------------- the Gateway-side runtime ------------------------ */

/** The same DataStore implementation the function used, bound to the
 * browser's own SDK client: every row read/write is a Gateway call made as
 * the signed-in user. */
const store: DataStore = blocksStore(() => blocksClient);
/** Avatar file storage: presign, short-lived download URLs and trash -- the
 * same calls the function made, now with the browser's own token (the one
 * that always carried the storage permissions). */
const files = blocksClient.data.files;

/** Fire-and-forget scheduler. The function had ctx.waitUntil; a browser tab
 * keeps its own promises alive, so a plain catch-all is the equivalent.
 * Closing the tab mid-generation stalls that job (it stays "running"). */
function schedule(promise: Promise<unknown>): void {
  promise.catch(() => undefined);
}

let emailCache: string | null = null;
let nameCache = "";

/** Identity: the email IAM attests for the caller's own token -- the same
 * resolution the function performed. Memberships, ownership and activity
 * actors key on it. */
async function identity(): Promise<{ email: string; name: string }> {
  if (emailCache) return { email: emailCache, name: nameCache };
  const claims = (await blocksClient.auth.userInfo()) as
    | Record<string, unknown>
    | undefined;
  const email = String(
    (claims?.email as string) ?? (claims?.preferred_username as string) ?? "",
  )
    .trim()
    .toLowerCase();
  if (!email) throw unauthorized("Please sign in to continue");
  nameCache = String(
    (claims?.name as string) ?? (claims?.given_name as string) ?? "",
  ).trim();
  emailCache = email;
  return { email, name: nameCache };
}

/** Tenant guard, ported from the function's support.ts: a missing membership
 * answers 404 so workspaces cannot be probed; a role below the minimum (or
 * lacking the permission) answers 403.
 *
 * TODO(iam-roles): minRole/permission checks run against the LOCAL workspace
 * membership table (owner > admin > editor > viewer), not the Blocks IAM
 * directory -- see the ROLE_RANK note in src/core/types.ts. Every
 * requireWorkspace call site below inherits this. */
async function requireWorkspace(
  workspaceId: string,
  minRole: WorkspaceRole,
  permission?: Permission,
): Promise<WorkspaceRole> {
  const { email } = await identity();
  const row = await store
    .getMembership(workspaceId, email)
    .catch(() => undefined);
  if (!row) throw notFound("Workspace not found");
  const role = row.role as WorkspaceRole;
  if (!hasAtLeast(role, minRole)) throw forbidden();
  if (permission && !can(role, permission)) throw forbidden();
  return role;
}

/* ----------------------------- route handlers ------------------------------ */
/* Ports of src/function/routes/* -- same inputs, same response bodies. */

async function getMe(): Promise<unknown> {
  const { email, name } = await identity();
  return {
    user: {
      id: email,
      email,
      name,
      emailVerified: true,
      createdAt: "",
    },
    workspaces: await workspaceSummary(),
    organizations: (await myOrganizations()).organizations,
  };
}

/** GET me/organizations -- the caller's SELISE Blocks organizations (the IAM
 * directory, read with the caller's own token). Best-effort: a directory
 * hiccup answers an empty list, never a broken page. */
async function myOrganizations(): Promise<{ organizations: Array<{ id: string; name: string }> }> {
  try {
    const res = await blocksClient.iam.organizations.my();
    const list = ((res as Record<string, unknown>)?.organizations ?? []) as Array<Record<string, unknown>>;
    return {
      organizations: list
        .map((o) => ({ id: String(o.itemId ?? ""), name: String(o.name ?? "Unnamed organization") }))
        .filter((o) => o.id),
    };
  } catch {
    return { organizations: [] };
  }
}

/** Row -> DTO for the workspace cards, ported from workspaces.ts. */
async function workspaceSummary() {
  const { email } = await identity();
  const rows = await store.listWorkspaceSummaries(email);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    organizationId: r.organization_id,
    role: r.role,
    isDemo: r.is_demo === 1,
    languageName: r.language_name,
    wordCount: r.word_count,
    createdAt: r.created_at,
  }));
}

async function listWorkspaces(): Promise<unknown> {
  return { workspaces: await workspaceSummary() };
}

async function createWorkspace(body: unknown): Promise<unknown> {
  const input = parseBody(workspaceCreateSchema, body);
  const { email } = await identity();
  const id = uid();
  await store.insertWorkspace({
    id,
    name: input.name,
    normalized_name: input.name.trim().toLowerCase(),
    owner_user_id: email,
    organization_id: input.organizationId ?? "",
    is_demo: 0,
    created_at: nowIso(),
  });
  // TODO(iam-roles): the creator becomes the workspace's local "owner" --
  // no IAM role is involved in this grant
  await store.insertMembership({
    id: uid(),
    workspace_id: id,
    user_id: email,
    role: "owner",
    created_at: nowIso(),
  });
  await logActivity(store, {
    workspaceId: id,
    actorUserId: email,
    action: "workspace.created",
    resourceType: "workspace",
    resourceId: id,
    metadata: { name: input.name },
  });
  return { workspace: { id, name: input.name, role: "owner" } };
}

async function getWorkspace(workspaceId: string): Promise<unknown> {
  const workspace = await store.getWorkspace(workspaceId);
  if (!workspace) throw notFound("Workspace not found");
  const role = await requireWorkspace(workspaceId, "viewer");
  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
      isDemo: workspace.is_demo === 1,
      role,
      createdAt: workspace.created_at,
    },
  };
}

async function renameWorkspace(workspaceId: string, body: unknown): Promise<unknown> {
  await requireWorkspace(workspaceId, "admin", "workspace:rename");
  const input = parseBody(workspaceUpdateSchema, body);
  await store.renameWorkspace(
    workspaceId,
    input.name,
    input.name.trim().toLowerCase(),
    nowIso(),
  );
  await logActivity(store, {
    workspaceId,
    actorUserId: (await identity()).email,
    action: "workspace.renamed",
    resourceType: "workspace",
    resourceId: workspaceId,
    metadata: { name: input.name },
  });
  return { message: "Workspace renamed." };
}

async function deleteWorkspace(workspaceId: string): Promise<unknown> {
  await requireWorkspace(workspaceId, "owner");
  await store.deleteWorkspace(workspaceId);
  return { message: "Workspace and all its data were deleted." };
}

function countRules(language: LanguageRow): number {
  try {
    const profile = JSON.parse(language.profile_json) as {
      grammarRules?: unknown[];
    };
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

async function getDashboard(workspaceId: string): Promise<unknown> {
  const role = await requireWorkspace(workspaceId, "viewer");
  const workspace = await store.getWorkspace(workspaceId);
  if (!workspace) throw notFound("Workspace not found");

  const [language, wordCount, withReference, lastUpdate, preview, activity] =
    await Promise.all([
      store.getLanguageByWorkspace(workspaceId),
      store.countEntries(workspaceId),
      store.countEntries(workspaceId, { withReference: true }),
      store.lastEntryUpdated(workspaceId),
      store.recentEntries(workspaceId, 5),
      store.listActivity(workspaceId, 8, 0),
    ]);

  let profile: { nativeName?: string } = {};
  if (language) {
    try {
      profile = JSON.parse(language.profile_json) as { nativeName?: string };
    } catch {
      profile = {};
    }
  }

  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
      isDemo: workspace.is_demo === 1,
      role,
    },
    language: language
      ? {
          id: language.id,
          name: language.name,
          nativeName: profile.nativeName ?? "",
          description: language.description,
          version: language.version,
          status: language.status,
          createdAt: language.created_at,
          updatedAt: language.updated_at,
        }
      : null,
    metrics: {
      words: wordCount,
      grammarRules: language ? countRules(language) : 0,
      mappedPercent:
        wordCount > 0 ? Math.round((withReference / wordCount) * 100) : 0,
      updatedAt: lastUpdate,
    },
    preview: preview.map((p) => ({
      id: p.id,
      word: p.word,
      bengaliMeaning: p.bengali_meaning,
      englishMeaning: p.english_meaning,
      partOfSpeech: p.part_of_speech,
      pronunciationGuide: p.pronunciation_guide,
      source: p.source,
    })),
    activity: activity.rows.map((a) => ({
      id: a.id,
      action: a.action,
      resourceType: a.resource_type,
      createdAt: a.created_at,
      metadata: safeJson(a.metadata_json),
    })),
  };
}

async function getActivity(
  workspaceId: string,
  query: Record<string, string>,
): Promise<unknown> {
  await requireWorkspace(workspaceId, "viewer");
  const { page, pageSize, offset } = pageParams(query, 25);
  const { rows, total } = await store.listActivity(workspaceId, pageSize, offset);
  return {
    total,
    page,
    pageSize,
    items: rows.map((a) => ({
      id: a.id,
      action: a.action,
      resourceType: a.resource_type,
      resourceId: a.resource_id,
      metadata: safeJson(a.metadata_json),
      createdAt: a.created_at,
    })),
  };
}

async function listMembers(workspaceId: string): Promise<unknown> {
  await requireWorkspace(workspaceId, "viewer");
  const memberships = await store.listMemberships(workspaceId);
  // user_id stores the member's email, so it doubles as the display address.
  const members = memberships
    .map((m) => ({
      user_id: m.user_id,
      role: m.role as WorkspaceRole,
      created_at: m.created_at,
      email: m.user_id,
    }))
    .sort((x, y) => x.created_at.localeCompare(y.created_at));
  return { members };
}

async function addMember(workspaceId: string, body: unknown): Promise<unknown> {
  await requireWorkspace(workspaceId, "admin", "members:manage");
  const input = parseBody(memberAddSchema, body);
  const email = input.email.trim().toLowerCase();
  const existing = await store.getMembership(workspaceId, email);
  if (existing)
    throw badRequest("That person is already a member of this workspace.");
  if (input.role === "owner")
    throw badRequest("Ownership is not transferable in this version.");
  await store.insertMembership({
    id: uid(),
    workspace_id: workspaceId,
    user_id: email,
    role: input.role,
    created_at: nowIso(),
  });
  await logActivity(store, {
    workspaceId,
    actorUserId: (await identity()).email,
    action: "member.added",
    resourceType: "membership",
    resourceId: email,
    metadata: { role: input.role },
  });
  return { message: "Member added." };
}

async function updateMember(
  workspaceId: string,
  targetUserId: string,
  body: unknown,
): Promise<unknown> {
  await requireWorkspace(workspaceId, "admin", "members:manage");
  const input = parseBody(memberUpdateSchema, body);
  const target = await store.getMembership(workspaceId, targetUserId);
  if (!target) throw notFound("Member not found");
  if (target.role === "owner" || input.role === "owner")
    throw badRequest("Ownership is not transferable in this version.");
  await store.updateMembershipRole(workspaceId, targetUserId, input.role);
  return { message: "Role updated." };
}

async function removeMember(
  workspaceId: string,
  targetUserId: string,
): Promise<unknown> {
  await requireWorkspace(workspaceId, "admin", "members:manage");
  const target = await store.getMembership(workspaceId, targetUserId);
  if (!target) throw notFound("Member not found");
  if (target.role === "owner")
    throw badRequest("The workspace owner cannot be removed.");
  await store.deleteMembership(workspaceId, targetUserId);
  return { message: "Member removed." };
}

async function getSecurity(workspaceId: string): Promise<unknown> {
  await requireWorkspace(workspaceId, "viewer");
  const [members, exportEvents, generationRuns] = await Promise.all([
    store.listMemberships(workspaceId).then((m) => m.length),
    store.countActivity(workspaceId, "dictionary.exported"),
    store.countJobs(workspaceId),
  ]);
  return {
    members,
    exportEvents,
    generationRuns,
    dataResidency: "workspace data stored in SELISE Blocks Data Gateway",
  };
}

/* -------------------------------- dictionary ------------------------------- */

async function listEntries(
  workspaceId: string,
  query: Record<string, string>,
): Promise<unknown> {
  await requireWorkspace(workspaceId, "viewer");
  const { page, pageSize, offset } = pageParams(query, 20, 100);
  const sort = query.sort ?? "alpha";
  const result = await store.listEntries(workspaceId, {
    q: query.q ?? "",
    pos: query.pos ?? "",
    learning: query.learning ?? "",
    source: query.source ?? "",
    sort: (["alpha", "newest", "updated", "needs_revision"] as const).includes(
      sort as "alpha",
    )
      ? (sort as "alpha" | "newest" | "updated" | "needs_revision")
      : "alpha",
    limit: pageSize,
    offset,
  });
  return {
    total: result.total,
    page,
    pageSize,
    items: result.rows.map(toEntryDTO),
  };
}

async function getTemplate(): Promise<unknown> {
  return { headers: CSV_TEMPLATE_HEADERS };
}

async function exportDictionary(
  workspaceId: string,
  query: Record<string, string>,
): Promise<unknown> {
  await requireWorkspace(workspaceId, "viewer", "dictionary:export");
  const format = query.format === "json" ? "json" : "csv";
  const file = await exportEntries(store, workspaceId, format);
  await logActivity(store, {
    workspaceId,
    actorUserId: (await identity()).email,
    action: "dictionary.exported",
    resourceType: "dictionary",
    resourceId: workspaceId,
    metadata: { format },
  });
  // downloadFile() builds the download client-side from this envelope.
  return { filename: file.filename, contentType: file.contentType, content: file.body };
}

async function importPreview(
  workspaceId: string,
  body: unknown,
): Promise<unknown> {
  await requireWorkspace(workspaceId, "editor", "dictionary:import");
  const input = parseBody(importPreviewSchema, body);
  const rows =
    input.format === "csv"
      ? gridToImportRows(parseCsv(input.content))
      : jsonToImportRows(input.content);
  if (rows.headerErrors.length > 0)
    throw badRequest(rows.headerErrors.join(" "));
  const report = await buildImportReport(store, workspaceId, rows.rows);
  return { report };
}

async function importCommit(
  workspaceId: string,
  body: unknown,
): Promise<unknown> {
  await requireWorkspace(workspaceId, "editor", "dictionary:import");
  const input = parseBody(importCommitSchema, body);
  const { email } = await identity();
  return commitImport(store, workspaceId, email, input.rows);
}

async function getEntry(workspaceId: string, entryId: string): Promise<unknown> {
  await requireWorkspace(workspaceId, "viewer");
  const entry = await store.getEntryById(entryId, workspaceId);
  if (!entry) throw notFound("Word not found");
  return { entry: toEntryDTO(entry) };
}

async function createEntry(
  workspaceId: string,
  body: unknown,
): Promise<unknown> {
  await requireWorkspace(workspaceId, "editor", "dictionary:write");
  const input = parseBody(dictionaryEntrySchema, body);
  const { email } = await identity();
  const norm = normalizeWord(input.word);
  const dup = await store.findEntryByNormalized(workspaceId, norm);
  if (dup) {
    throw conflict(
      `"${dup.word}" already exists in this dictionary.`,
      { existingId: dup.id, existingWord: dup.word },
    );
  }
  const id = uid();
  const now = nowIso();
  const language = await store.getLanguageByWorkspace(workspaceId);
  await store.insertEntry({
    id,
    workspace_id: workspaceId,
    language_id: language?.id ?? null,
    word: input.word,
    normalized_word: norm,
    bengali_meaning: input.bengaliMeaning ?? "",
    english_meaning: input.englishMeaning ?? "",
    pronunciation_guide: input.pronunciationGuide ?? "",
    ipa: input.ipa ?? "",
    part_of_speech: input.partOfSpeech ?? "noun",
    root: input.root ?? "",
    word_formation_explanation: input.wordFormationExplanation ?? "",
    prefixes: "",
    suffixes: "",
    grammar_notes: input.grammarNotes ?? "",
    example_sentences_json: JSON.stringify(input.exampleSentences ?? []),
    related_word_ids_json: "[]",
    mnemonic: input.mnemonic ?? "",
    learning_status: "new",
    source: "user",
    status: input.status ?? "approved",
    archived: 0,
    entry_version: 1,
    history_json: "[]",
    created_at: now,
    updated_at: now,
  });
  await logActivity(store, {
    workspaceId,
    actorUserId: email,
    action: "dictionary.word_added",
    resourceType: "dictionary_entry",
    resourceId: id,
    metadata: { word: input.word },
  });
  const entry = await store.getEntryById(id, workspaceId);
  if (!entry) throw notFound("Word not found");
  return { entry: toEntryDTO(entry) };
}

async function updateEntry(
  workspaceId: string,
  entryId: string,
  body: unknown,
): Promise<unknown> {
  await requireWorkspace(workspaceId, "editor", "dictionary:write");
  const entry = await store.getEntryById(entryId, workspaceId);
  if (!entry) throw notFound("Word not found");
  const input = parseBody(entryUpdateSchema, body);
  const { email } = await identity();

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const updatable: Array<[keyof typeof input, keyof EntryRow]> = [
    ["word", "word"],
    ["bengaliMeaning", "bengali_meaning"],
    ["englishMeaning", "english_meaning"],
    ["pronunciationGuide", "pronunciation_guide"],
    ["ipa", "ipa"],
    ["partOfSpeech", "part_of_speech"],
    ["root", "root"],
    ["wordFormationExplanation", "word_formation_explanation"],
    ["prefixes", "prefixes"],
    ["suffixes", "suffixes"],
    ["grammarNotes", "grammar_notes"],
    ["mnemonic", "mnemonic"],
    ["status", "status"],
    ["learningStatus", "learning_status"],
  ];
  const patch: Partial<EntryRow> = {};
  for (const [field, column] of updatable) {
    const value = input[field];
    if (value === undefined) continue;
    const current = entry[column];
    if (value !== current) {
      changes[field as string] = { from: current, to: value };
    }
    (patch as Record<string, unknown>)[column] = value;
  }
  if (input.exampleSentences !== undefined) {
    const current = JSON.parse(entry.example_sentences_json) as unknown;
    if (JSON.stringify(current) !== JSON.stringify(input.exampleSentences)) {
      changes.exampleSentences = { from: current, to: input.exampleSentences };
    }
    patch.example_sentences_json = JSON.stringify(input.exampleSentences);
  }
  if (Object.keys(patch).length === 0) {
    return { entry: toEntryDTO(entry), message: "Nothing to update." };
  }

  if (input.word !== undefined) {
    const norm = normalizeWord(input.word);
    const dup = await store.findEntryByNormalized(workspaceId, norm, {
      excludeId: entry.id,
    });
    if (dup)
      throw conflict(`"${input.word}" already exists in this dictionary.`, {
        existingWord: input.word,
      });
    patch.normalized_word = norm;
  }

  const history = JSON.parse(entry.history_json) as Array<unknown>;
  history.push({ at: nowIso(), changes });
  patch.entry_version = entry.entry_version + 1;
  patch.history_json = JSON.stringify(history);
  patch.updated_at = nowIso();
  await store.updateEntry(workspaceId, entry.id, patch);

  await logActivity(store, {
    workspaceId,
    actorUserId: email,
    action: "dictionary.word_updated",
    resourceType: "dictionary_entry",
    resourceId: entry.id,
    metadata: { fields: Object.keys(changes) },
  });
  const updated = await store.getEntryById(entry.id, workspaceId);
  if (!updated) throw notFound("Word not found");
  return { entry: toEntryDTO(updated) };
}

async function archiveEntry(
  workspaceId: string,
  entryId: string,
): Promise<unknown> {
  await requireWorkspace(workspaceId, "editor", "dictionary:write");
  const entry = await store.getEntryById(entryId, workspaceId);
  if (!entry) throw notFound("Word not found");
  await store.updateEntry(workspaceId, entry.id, {
    archived: 1,
    updated_at: nowIso(),
  });
  await logActivity(store, {
    workspaceId,
    actorUserId: (await identity()).email,
    action: "dictionary.word_archived",
    resourceType: "dictionary_entry",
    resourceId: entry.id,
    metadata: { word: entry.word },
  });
  return { message: `"${entry.word}" was archived. You can restore it.` };
}

async function restoreEntry(
  workspaceId: string,
  entryId: string,
): Promise<unknown> {
  await requireWorkspace(workspaceId, "editor", "dictionary:write");
  const entry = await store.getEntryById(entryId, workspaceId, {
    includeArchived: true,
  });
  if (!entry) throw notFound("Word not found");
  await store.updateEntry(workspaceId, entry.id, {
    archived: 0,
    updated_at: nowIso(),
  });
  await logActivity(store, {
    workspaceId,
    actorUserId: (await identity()).email,
    action: "dictionary.word_restored",
    resourceType: "dictionary_entry",
    resourceId: entry.id,
    metadata: { word: entry.word },
  });
  return { message: `"${entry.word}" was restored.` };
}

async function getHistory(
  workspaceId: string,
  entryId: string,
): Promise<unknown> {
  await requireWorkspace(workspaceId, "viewer");
  const entry = await store.getEntryById(entryId, workspaceId);
  if (!entry) throw notFound("Word not found");
  return {
    history: JSON.parse(entry.history_json) as unknown[],
    version: entry.entry_version,
  };
}

/* --------------------------------- language -------------------------------- */

async function getLanguage(workspaceId: string): Promise<unknown> {
  await requireWorkspace(workspaceId, "viewer");
  const language = await getLanguageForWorkspace(store, workspaceId);
  if (!language) return { language: null };
  const activeJob = await store.getActiveJob(workspaceId);
  const profile = getProfile(language);
  return {
    language: {
      id: language.id,
      name: language.name,
      nativeName: profile?.nativeName ?? "",
      description: language.description,
      status: language.status,
      version: language.version,
      wordOrder: profile?.wordOrder ?? null,
      style: profile?.style ?? null,
      vocabularyCount: profile?.vocabulary.length ?? 0,
      rulesCount: profile?.grammarRules.length ?? 0,
      warnings: profile?.consistencyWarnings ?? [],
      versionSummary: profile?.versionSummary ?? "",
      createdAt: language.created_at,
      updatedAt: language.updated_at,
    },
    activeJob: activeJob ?? null,
  };
}

async function generateLanguage(
  workspaceId: string,
  body: unknown,
): Promise<unknown> {
  await requireWorkspace(workspaceId, "editor", "language:generate");
  const input = parseBody(generateRequestSchema, body);
  const count = await store.countEntries(workspaceId);
  if (count === 0) {
    throw badRequest(
      "Your dictionary is empty, so there is nothing to generate a language from yet. Add or import words first, or start with the starter dictionary.",
      "dictionary_empty",
    );
  }
  const { email } = await identity();
  const job = await createGenerationJob(store, {
    workspaceId,
    userId: email,
    style: input.style,
    referenceLangs: input.referenceLangs,
    preferredName: input.preferredName,
  });
  // Fire-and-forget: the job persists its own stages; the page polls.
  schedule(runGenerationJob(store, job.id));
  return { jobId: job.id, status: job.status };
}

function safeParseStages(job: {
  stages_json: string;
}): unknown {
  try {
    return JSON.parse(job.stages_json);
  } catch {
    return [];
  }
}

async function getJobState(
  workspaceId: string,
  jobId: string,
): Promise<unknown> {
  await requireWorkspace(workspaceId, "viewer");
  const job = await getJob(store, jobId);
  if (!job || job.workspace_id !== workspaceId) throw notFound("Job not found");
  return {
    id: job.id,
    status: job.status,
    stages: safeParseStages(job),
    result: job.result_json ? JSON.parse(job.result_json) : null,
    error: job.error,
  };
}

async function cancelJob(
  workspaceId: string,
  jobId: string,
): Promise<unknown> {
  await requireWorkspace(workspaceId, "editor");
  const job = await cancelGenerationJob(store, jobId, workspaceId);
  return { id: job.id, status: job.status };
}

async function getGrammar(workspaceId: string): Promise<unknown> {
  await requireWorkspace(workspaceId, "viewer");
  const language = await getLanguageForWorkspace(store, workspaceId);
  if (!language) throw notFound("No language has been generated yet");
  const profile = getProfile(language);
  if (!profile) throw notFound("Language profile is unreadable");
  return {
    language: {
      id: language.id,
      name: language.name,
      nativeName: profile.nativeName,
      version: language.version,
      wordOrder: profile.wordOrder,
    },
    writingSystem: profile.writingSystem,
    phonology: profile.phonology,
    wordFormation: profile.wordFormation,
    rules: profile.grammarRules,
  };
}

async function listVersions(workspaceId: string): Promise<unknown> {
  await requireWorkspace(workspaceId, "viewer");
  const language = await getLanguageForWorkspace(store, workspaceId);
  if (!language) return { versions: [] };
  const versions = await store.listVersions(language.id);
  return {
    versions: versions.map((v) => ({
      version: v.version,
      change_summary: v.change_summary,
      created_by: v.created_by,
      created_at: v.created_at,
    })),
  };
}

async function restoreVersion(
  workspaceId: string,
  versionParam: string,
): Promise<unknown> {
  await requireWorkspace(workspaceId, "admin", "language:restore");
  const language = await getLanguageForWorkspace(store, workspaceId);
  if (!language) throw notFound("No language to restore");
  const version = Number(versionParam);
  const snapshot = await store.getVersion(language.id, version);
  if (!snapshot) throw notFound("Version not found");

  const { email } = await identity();
  const newVersion = language.version + 1;
  const now = nowIso();
  await store.updateLanguage(language.id, {
    version: newVersion,
    profile_json: snapshot.snapshot_json,
    updated_at: now,
  });
  await store.insertVersion({
    id: uid(),
    workspace_id: workspaceId,
    language_id: language.id,
    version: newVersion,
    snapshot_json: snapshot.snapshot_json,
    change_summary: `Restored from version ${version}`,
    created_by: email,
    created_at: now,
  });
  await logActivity(store, {
    workspaceId,
    actorUserId: email,
    action: "language.restored",
    resourceType: "language",
    resourceId: language.id,
    metadata: { fromVersion: version, toVersion: newVersion },
  });
  return {
    message: `Version ${version} restored as version ${newVersion}.`,
    version: newVersion,
  };
}

async function renameLanguage(
  workspaceId: string,
  body: unknown,
): Promise<unknown> {
  await requireWorkspace(workspaceId, "editor", "language:rename");
  const input = parseBody(languageRenameSchema, body);
  const language = await getLanguageForWorkspace(store, workspaceId);
  if (!language) throw notFound("No language to rename");
  const norm = normalizeWord(input.name);
  const names = await store.listLanguageNormalizedNames();
  if (names.includes(norm) && norm !== language.normalized_name.toLowerCase()) {
    throw conflict(
      `The name "${input.name}" is already used by another language. Try another.`,
    );
  }
  const profile = getProfile(language);
  if (profile) profile.name = input.name;
  await store.updateLanguage(language.id, {
    name: input.name,
    normalized_name: norm,
    profile_json: profile ? JSON.stringify(profile) : language.profile_json,
    updated_at: nowIso(),
  });
  await logActivity(store, {
    workspaceId,
    actorUserId: (await identity()).email,
    action: "language.renamed",
    resourceType: "language",
    resourceId: language.id,
    metadata: { name: input.name },
  });
  return { message: "Language renamed.", name: input.name };
}

/* ------------------------------ tools -------------------------------------- */

async function suggestWordRoute(
  workspaceId: string,
  body: unknown,
): Promise<unknown> {
  await requireWorkspace(workspaceId, "editor", "dictionary:write");
  const input = parseBody(suggestWordSchema, body);
  return { suggestion: await suggestWord(store, workspaceId, input) };
}

async function approveWordRoute(
  workspaceId: string,
  body: unknown,
): Promise<unknown> {
  await requireWorkspace(workspaceId, "editor", "dictionary:write");
  const input = parseBody(approveWordSchema, body);
  const { email } = await identity();
  return approveSuggestedWord(store, workspaceId, email, input);
}

async function translateRoute(
  workspaceId: string,
  body: unknown,
): Promise<unknown> {
  await requireWorkspace(workspaceId, "viewer", "dictionary:read");
  const input = parseBody(translateSchema, body);
  return translate(store, workspaceId, input);
}

async function listPhrasebook(workspaceId: string): Promise<unknown> {
  await requireWorkspace(workspaceId, "viewer", "dictionary:read");
  const items = (await store.listPhrasebook(workspaceId, 100)).map((r) => ({
    id: r.id,
    sourceText: r.source_text,
    sourceLang: r.source_lang,
    translatedText: r.translated_text,
    targetLang: r.target_lang,
    note: r.note ?? "",
    createdAt: r.created_at,
  }));
  return { items };
}

async function addPhrase(
  workspaceId: string,
  body: unknown,
): Promise<unknown> {
  await requireWorkspace(workspaceId, "editor", "dictionary:write");
  const input = parseBody(phrasebookAddSchema, body);
  const id = uid();
  await store.insertPhrasebook({
    id,
    workspace_id: workspaceId,
    source_text: input.sourceText,
    source_lang: input.sourceLang,
    translated_text: input.translatedText,
    target_lang: input.targetLang,
    note: input.note ?? "",
    created_at: nowIso(),
  });
  return { id, message: "Saved to phrasebook." };
}

async function removePhrase(
  workspaceId: string,
  phraseId: string,
): Promise<unknown> {
  await requireWorkspace(workspaceId, "editor", "dictionary:write");
  await store.deletePhrasebook(phraseId, workspaceId);
  return { message: "Removed from phrasebook." };
}

async function practiceQueue(
  workspaceId: string,
  query: Record<string, string>,
): Promise<unknown> {
  await requireWorkspace(workspaceId, "viewer", "dictionary:read");
  const modeParam = query.mode ?? "mixed";
  const mode = (SCHEMA_PRACTICE_MODES as readonly string[]).includes(modeParam)
    ? (modeParam as (typeof SCHEMA_PRACTICE_MODES)[number])
    : "mixed";
  const limit = Math.min(20, Math.max(1, Number(query.limit) || 10));
  const { email } = await identity();
  const [items, stats] = await Promise.all([
    getPracticeQueue(store, workspaceId, email, mode, limit),
    getPracticeStats(store, workspaceId, email),
  ]);
  return { items, stats };
}

async function practiceReview(
  workspaceId: string,
  body: unknown,
): Promise<unknown> {
  await requireWorkspace(workspaceId, "viewer", "dictionary:read");
  const input = parseBody(practiceReviewSchema, body);
  const { email } = await identity();
  return applyReview(store, {
    workspaceId,
    userId: email,
    entryId: input.entryId,
    mode: input.mode,
    correct: input.correct,
  });
}

async function practiceStats(workspaceId: string): Promise<unknown> {
  await requireWorkspace(workspaceId, "viewer", "dictionary:read");
  const { email } = await identity();
  return { stats: await getPracticeStats(store, workspaceId, email) };
}

/* ------------------------------- dispatcher -------------------------------- */

function flat(query: Record<string, string | string[]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) {
    if (typeof v === "string") out[k] = v;
    else if (Array.isArray(v) && typeof v[0] === "string") out[k] = v[0];
  }
  return out;
}

/* --------------------------- avatar (file storage) ------------------------- */
/* Port of the function's last surface: presign, short-lived download URLs and
   file trash, made with the caller's own token. The avatar pointer lives in
   the UserProfile schema (keyed by lowercase email). */

const AVATAR_STORAGE_CONFIG = "Default";

/** Storage file extension per accepted image type -- presign requires a
 *  name with an allowed extension (blocks-data-storage skill). */
const AVATAR_EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;

/** GET me/avatar -- the caller's avatar: the Blocks Data file id plus a fresh
 *  short-lived download URL. Download URLs expire, so this is re-fetched per
 *  page load. */
async function getAvatar(): Promise<unknown> {
  const { email } = await identity();
  const fileId = await store.getAvatarFileId(email);
  if (!fileId) return { fileId: null, downloadUrl: null };
  try {
    const res = await files.get(fileId, { configurationName: AVATAR_STORAGE_CONFIG });
    return { fileId, downloadUrl: pickFileUrl(res) };
  } catch {
    return { fileId, downloadUrl: null };
  }
}

/** POST me/avatar/upload-url -- pre-signed upload URL. Returns
 *  { uploadUrl, fileId, requiredHeaders }; the page PUTs the bytes straight
 *  to Azure (with those headers) and then PATCHes the pointer. Private
 *  access modifier, 5 MB cap enforced client-side. */
async function createAvatarUploadUrl(body: unknown): Promise<unknown> {
  const parsed = parseBody(avatarUploadSchema, body);
  // Storage errors carry the gateway's own reason (BlocksApiError.message) —
  // surface it instead of a blind 500 so failures diagnose themselves.
  let res: unknown;
  try {
    const { email } = await identity();
    res = await files.presignedUploadUrl({
      name: `avatar-${email.split("@")[0]}-${Date.now()}.${AVATAR_EXTENSIONS[parsed.contentType]}`,
      configurationName: AVATAR_STORAGE_CONFIG,
      accessModifier: "Private",
      contentType: parsed.contentType
    });
  } catch (e) {
    const reason = e instanceof Error && e.message ? e.message : "unknown storage error";
    throw badRequest(`Storage presign failed: ${reason.slice(0, 300)}. Please try again.`);
  }
  const found = extractPresign(res);
  if (!found.uploadUrl || !found.fileId) {
    throw badRequest(`Storage presign failed: ${describePresignFailure(res)}. Please try again.`);
  }
  return { uploadUrl: found.uploadUrl, fileId: found.fileId, requiredHeaders: found.requiredHeaders ?? {} };
}

/** The presign payload has appeared top-level and nested under `data` on
 *  different endpoints — walk a few levels and take the fields by name,
 *  including the requiredHeaders the provider expects on the PUT. */
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
 *  `errors` when isSuccess=false, otherwise the top-level keys (the envelope
 *  shape has drifted before) — never the signed values themselves. */
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
 *  avatar, trashing the previous file (best-effort). */
async function setAvatar(body: unknown): Promise<unknown> {
  const { email } = await identity();
  const parsed = parseBody(avatarSchema, body);
  const fileId = parsed.fileId.trim();
  const previousFileId = await store.getAvatarFileId(email);
  await store.setAvatarFileId(email, fileId);
  if (previousFileId && previousFileId !== fileId) {
    await files.delete({ fileId: previousFileId, permanent: false }).catch(() => undefined);
  }
  return { fileId };
}

/** DELETE me/avatar -- clear the pointer and trash the file (best-effort). */
async function deleteAvatar(): Promise<unknown> {
  const { email } = await identity();
  const previousFileId = await store.getAvatarFileId(email);
  await store.setAvatarFileId(email, "");
  if (previousFileId) {
    await files.delete({ fileId: previousFileId, permanent: false }).catch(() => undefined);
  }
  return { fileId: null };
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

/** The route table the function used to own, now resolved locally against the
 * Gateway. Paths are the same ones the pages always called. */
async function localRoute(
  method: string,
  segs: string[],
  query: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  const [head, second, third, fourth] = segs;

  if (head === "me" && segs.length === 1) {
    if (method === "GET") return getMe();
    throw methodNotAllowed();
  }

  if (head === "me" && second === "organizations" && segs.length === 2) {
    if (method === "GET") return myOrganizations();
    throw methodNotAllowed();
  }

  if (head === "me" && second === "avatar") {
    if (third === "upload-url") {
      if (method === "POST") return createAvatarUploadUrl(body);
      throw methodNotAllowed();
    }
    if (method === "GET") return getAvatar();
    if (method === "PATCH") return setAvatar(body);
    if (method === "DELETE") return deleteAvatar();
    throw methodNotAllowed();
  }

  if (head === "workspaces" && segs.length === 1) {
    if (method === "GET") return listWorkspaces();
    if (method === "POST") return createWorkspace(body);
    throw methodNotAllowed();
  }

  if (head === "ws" && second) {
    // Tenant guard for everything under /ws/:id (404 for non-members).
    const role = await requireWorkspace(second, "viewer");
    void role;
    return routeWorkspace(method, second, segs.slice(2), query, body);
  }

  throw notFound("API route not found");
}

async function routeWorkspace(
  method: string,
  workspaceId: string,
  segs: string[],
  query: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  const [family, a, b] = segs;

  if (segs.length === 0) {
    if (method === "GET") return getWorkspace(workspaceId);
    if (method === "PATCH") return renameWorkspace(workspaceId, body);
    if (method === "DELETE") return deleteWorkspace(workspaceId);
    throw methodNotAllowed();
  }

  switch (family) {
    case "dashboard":
      return getDashboard(workspaceId);
    case "activity":
      return getActivity(workspaceId, query);
    case "security":
      return getSecurity(workspaceId);
    case "members":
      if (segs.length === 1 && method === "GET") return listMembers(workspaceId);
      if (segs.length === 1 && method === "POST") return addMember(workspaceId, body);
      if (segs.length === 2 && a && method === "PATCH")
        return updateMember(workspaceId, a, body);
      if (segs.length === 2 && a && method === "DELETE")
        return removeMember(workspaceId, a);
      throw methodNotAllowed();
    case "dictionary":
      return routeDictionary(method, workspaceId, segs.slice(1), query, body);
    case "language":
      return routeLanguage(method, workspaceId, segs.slice(1), query, body);
    case "word-builder":
      if (a === "suggest" && method === "POST")
        return suggestWordRoute(workspaceId, body);
      if (a === "approve" && method === "POST")
        return approveWordRoute(workspaceId, body);
      throw notFound("API route not found");
    case "translate":
      if (method === "POST") return translateRoute(workspaceId, body);
      throw notFound("API route not found");
    case "phrasebook":
      if (segs.length === 1 && method === "GET") return listPhrasebook(workspaceId);
      if (segs.length === 1 && method === "POST") return addPhrase(workspaceId, body);
      if (segs.length === 2 && a && method === "DELETE")
        return removePhrase(workspaceId, a);
      throw notFound("API route not found");
    case "practice":
      if (a === "queue" && method === "GET")
        return practiceQueue(workspaceId, query);
      if (a === "review" && method === "POST")
        return practiceReview(workspaceId, body);
      if (a === "stats" && method === "GET") return practiceStats(workspaceId);
      throw notFound("API route not found");
    default:
      throw notFound("API route not found");
  }
  void b;
}

async function routeDictionary(
  method: string,
  workspaceId: string,
  segs: string[],
  query: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  const [a, b] = segs;

  if (segs.length === 0) {
    if (method === "GET") return listEntries(workspaceId, query);
    if (method === "POST") return createEntry(workspaceId, body);
    throw methodNotAllowed();
  }
  // Explicit paths must win over :entryId.
  if (a === "template" && method === "GET") return getTemplate();
  if (a === "export" && method === "GET") return exportDictionary(workspaceId, query);
  if (a === "import" && b === "preview" && method === "POST")
    return importPreview(workspaceId, body);
  if (a === "import" && b === "commit" && method === "POST")
    return importCommit(workspaceId, body);

  if (a) {
    if (b === "restore" && method === "POST") return restoreEntry(workspaceId, a);
    if (b === "history" && method === "GET") return getHistory(workspaceId, a);
    if (!b) {
      if (method === "GET") return getEntry(workspaceId, a);
      if (method === "PATCH") return updateEntry(workspaceId, a, body);
      if (method === "DELETE") return archiveEntry(workspaceId, a);
    }
  }
  throw notFound("API route not found");
}

async function routeLanguage(
  method: string,
  workspaceId: string,
  segs: string[],
  _query: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  const [a, b, c] = segs;

  if (segs.length === 0) {
    if (method === "GET") return getLanguage(workspaceId);
    if (method === "PATCH") return renameLanguage(workspaceId, body);
    throw methodNotAllowed();
  }
  if (a === "generate" && method === "POST")
    return generateLanguage(workspaceId, body);
  if (a === "grammar" && method === "GET") return getGrammar(workspaceId);
  if (a === "versions" && segs.length === 1 && method === "GET")
    return listVersions(workspaceId);
  if (a === "versions" && b && c === "restore" && method === "POST")
    return restoreVersion(workspaceId, b);
  if (a === "jobs" && b) {
    if (!c && method === "GET") return getJobState(workspaceId, b);
    if (c === "cancel" && method === "POST") return cancelJob(workspaceId, b);
  }
  throw notFound("API route not found");
}

const methodNotAllowed = () =>
  new HttpError(405, "Method not allowed for this route", "method_not_allowed");

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const { path: routePath, query } = splitPath(path);
  const segs = routePath.split("/").filter(Boolean);

  try {
    return (await localRoute(method, segs, flat(query), body ?? {})) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof HttpError) {
      throw new ApiError(err.status, err.code, err.message, err.details);
    }
    throw new ApiError(
      0,
      "network",
      err instanceof Error
        ? err.message
        : "Could not reach the data gateway",
    );
  }
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) =>
    request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) =>
    request<T>("PATCH", path, body ?? {}),
  del: <T>(path: string) => request<T>("DELETE", path),
};

/** Download an endpoint that answers with a { filename, contentType, content }
 *  envelope (the export routes) and save it client-side. */
export async function downloadFile(path: string): Promise<void> {
  const file = await api.get<{
    filename: string;
    contentType: string;
    content: string;
  }>(path);
  const blob = new Blob([file.content], { type: file.contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------ shared API types --------------------------- */

export interface PublicUser {
  id: string;
  email: string;
  /** IAM display name; empty when the token carries no name claim. */
  name?: string;
  emailVerified: boolean;
  createdAt: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  /** SELISE Blocks organization tag; "" when the workspace has none. */
  organizationId: string;
  role: "owner" | "admin" | "editor" | "viewer";
  isDemo: boolean;
  languageName: string | null;
  wordCount: number;
  createdAt: string;
}

export interface EntryDTO {
  id: string;
  workspaceId: string;
  languageId: string | null;
  word: string;
  bengaliMeaning: string;
  englishMeaning: string;
  pronunciationGuide: string;
  ipa: string;
  partOfSpeech: string;
  root: string;
  wordFormationExplanation: string;
  prefixes: string;
  suffixes: string;
  grammarNotes: string;
  exampleSentences: Array<{
    constructed: string;
    bengali: string;
    english: string;
  }>;
  relatedWordIds: string[];
  mnemonic: string;
  learningStatus: string;
  source: "user" | "generated" | "imported";
  status: "draft" | "approved";
  archived: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ImportReport {
  totalRows: number;
  validCount: number;
  invalid: Array<{ row: number; word: string; issues: string[] }>;
  duplicatesInFile: Array<{ row: number; word: string }>;
  duplicatesInDictionary: Array<{
    row: number;
    word: string;
    existing: string;
  }>;
  warnings: string[];
  rows: Array<Record<string, string>>;
}

export interface LanguageSummary {
  id: string;
  name: string;
  nativeName: string;
  description: string;
  status: string;
  version: number;
  wordOrder: string | null;
  style: string | null;
  vocabularyCount: number;
  rulesCount: number;
  warnings: string[];
  versionSummary: string;
  createdAt: string;
  updatedAt: string;
}

export interface GrammarData {
  language: {
    id: string;
    name: string;
    nativeName: string;
    version: number;
    wordOrder: string;
  };
  writingSystem: {
    type: string;
    description: string;
    alphabet: string[];
    numerals: string;
    capitalization: string;
  };
  phonology: {
    consonants: string[];
    vowels: string[];
    syllableStructures: string[];
    stressRule: string;
    forbiddenClusters: string[];
    pronunciationConventions: Array<{ symbol: string; guide: string }>;
  };
  wordFormation: {
    prefixes: Array<{ affix: string; meaning: string }>;
    suffixes: Array<{ affix: string; meaning: string }>;
  };
  rules: Array<{
    id: string;
    name: string;
    category: string;
    explanationEnglish: string;
    explanationBengali: string;
    pattern: string;
    validExamples: string[];
    invalidExamples: Array<{ example: string; why: string }>;
    introducedInVersion: number;
  }>;
}

export interface JobState {
  id: string;
  status:
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "timeout";
  stages: Array<{
    id: string;
    label: string;
    labelBn: string;
    status: "pending" | "running" | "done";
  }>;
  result: {
    languageId: string;
    name: string;
    nativeName: string;
    version: number;
    wordCount: number;
    rulesCount: number;
    generatedDrafts: number;
    warnings: string[];
  } | null;
  error: string | null;
}

export const PARTS_OF_SPEECH = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "pronoun",
  "preposition",
  "conjunction",
  "interjection",
  "phrase",
] as const;
export const GEN_STYLES = [
  "naturalistic",
  "concise",
  "formal",
  "futuristic",
  "original",
] as const;
export const PRACTICE_MODES = [
  "word_to_bengali",
  "word_to_english",
  "bengali_to_word",
  "english_to_word",
  "fill_blank",
  "choose_word",
  "pronounciation",
] as const;
