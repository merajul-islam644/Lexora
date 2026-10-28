import { uid, nowIso, normalizeWord } from "../../core/db/ids.js";
import { parseBody } from "../../core/lib/validate.js";
import { generateRequestSchema, languageRenameSchema } from "../../shared/schemas.js";
import { conflict, notFound, badRequest } from "../../core/lib/errors.js";
import { logActivity } from "../../core/services/activity.js";
import { createGenerationJob, runGenerationJob, getJob, cancelGenerationJob } from "../../core/services/generationRunner.js";
import { getLanguageForWorkspace, getProfile } from "../../core/services/translation.js";
import type { JobRow } from "../../core/db/rows.js";
import type { ApiDeps, ApiRequest, ApiResponse } from "../support.js";
import { accepted, ok, requireWorkspace } from "../support.js";
import type { LanguageProfile } from "../../shared/schemas.js";

/* Language domain: summary, generation jobs (work continues after the 202
   answer via ctx.waitUntil), grammar view, version history and restore,
   rename. Ported from the Express language routes. */

export async function getLanguage(deps: ApiDeps, req: ApiRequest, workspaceId: string): Promise<ApiResponse> {
  const language = await getLanguageForWorkspace(deps.store, workspaceId);
  if (!language) return ok({ language: null });
  const activeJob = await deps.store.getActiveJob(workspaceId);
  const profile = getProfile(language);
  return ok({
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
      updatedAt: language.updated_at
    },
    activeJob: activeJob ?? null
  });
}

export async function generate(deps: ApiDeps, req: ApiRequest, workspaceId: string): Promise<ApiResponse> {
  await requireWorkspace(deps, workspaceId, req.userEmail, "editor", "language:generate");
  const body = parseBody(generateRequestSchema, req.body);
  const count = await deps.store.countEntries(workspaceId);
  if (count === 0) {
    throw badRequest(
      "Your dictionary is empty, so there is nothing to generate a language from yet. Add or import words first, or start with the starter dictionary.",
      "dictionary_empty"
    );
  }
  const job = await createGenerationJob(deps.store, {
    workspaceId,
    userId: req.userEmail,
    style: body.style,
    referenceLangs: body.referenceLangs,
    preferredName: body.preferredName
  });
  // Fire-and-forget: the job persists its own stages; the client polls.
  // waitUntil keeps the sandbox alive for this work after the answer.
  deps.schedule(runGenerationJob(deps.store, job.id));
  return accepted({ jobId: job.id, status: job.status });
}

export async function getJobState(deps: ApiDeps, req: ApiRequest, workspaceId: string, jobId: string): Promise<ApiResponse> {
  const job = await getJob(deps.store, jobId);
  if (!job || job.workspace_id !== workspaceId) throw notFound("Job not found");
  return ok({
    id: job.id,
    status: job.status,
    stages: safeParseStages(job),
    result: job.result_json ? JSON.parse(job.result_json) : null,
    error: job.error
  });
}

export async function cancelJob(deps: ApiDeps, req: ApiRequest, workspaceId: string, jobId: string): Promise<ApiResponse> {
  await requireWorkspace(deps, workspaceId, req.userEmail, "editor");
  const job = await cancelGenerationJob(deps.store, jobId, workspaceId);
  return ok({ id: job.id, status: job.status });
}

export async function getGrammar(deps: ApiDeps, req: ApiRequest, workspaceId: string): Promise<ApiResponse> {
  const language = await getLanguageForWorkspace(deps.store, workspaceId);
  if (!language) throw notFound("No language has been generated yet");
  const profile = getProfile(language);
  if (!profile) throw notFound("Language profile is unreadable");
  return ok({
    language: { id: language.id, name: language.name, nativeName: profile.nativeName, version: language.version, wordOrder: profile.wordOrder },
    writingSystem: profile.writingSystem,
    phonology: profile.phonology,
    wordFormation: profile.wordFormation,
    rules: profile.grammarRules
  });
}

export async function listVersions(deps: ApiDeps, req: ApiRequest, workspaceId: string): Promise<ApiResponse> {
  const language = await getLanguageForWorkspace(deps.store, workspaceId);
  if (!language) return ok({ versions: [] });
  const versions = await deps.store.listVersions(language.id);
  return ok({
    versions: versions.map((v) => ({ version: v.version, change_summary: v.change_summary, created_by: v.created_by, created_at: v.created_at }))
  });
}

export async function restoreVersion(deps: ApiDeps, req: ApiRequest, workspaceId: string, versionParam: string): Promise<ApiResponse> {
  await requireWorkspace(deps, workspaceId, req.userEmail, "admin", "language:restore");
  const language = await getLanguageForWorkspace(deps.store, workspaceId);
  if (!language) throw notFound("No language to restore");
  const version = Number(versionParam);
  const snapshot = await deps.store.getVersion(language.id, version);
  if (!snapshot) throw notFound("Version not found");

  const newVersion = language.version + 1;
  const now = nowIso();
  await deps.store.updateLanguage(language.id, { version: newVersion, profile_json: snapshot.snapshot_json, updated_at: now });
  await deps.store.insertVersion({
    id: uid(),
    workspace_id: workspaceId,
    language_id: language.id,
    version: newVersion,
    snapshot_json: snapshot.snapshot_json,
    change_summary: `Restored from version ${version}`,
    created_by: req.userEmail,
    created_at: now
  });
  await logActivity(deps.store, {
    workspaceId,
    actorUserId: req.userEmail,
    action: "language.restored",
    resourceType: "language",
    resourceId: language.id,
    metadata: { fromVersion: version, toVersion: newVersion }
  });
  return ok({ message: `Version ${version} restored as version ${newVersion}.`, version: newVersion });
}

export async function renameLanguage(deps: ApiDeps, req: ApiRequest, workspaceId: string): Promise<ApiResponse> {
  await requireWorkspace(deps, workspaceId, req.userEmail, "editor", "language:rename");
  const body = parseBody(languageRenameSchema, req.body);
  const language = await getLanguageForWorkspace(deps.store, workspaceId);
  if (!language) throw notFound("No language to rename");
  const norm = normalizeWord(body.name);
  const names = await deps.store.listLanguageNormalizedNames();
  if (names.includes(norm) && norm !== language.normalized_name.toLowerCase()) {
    throw conflict(`The name "${body.name}" is already used by another language. Try another.`);
  }
  const profile = getProfile(language);
  if (profile) profile.name = body.name;
  await deps.store.updateLanguage(language.id, {
    name: body.name,
    normalized_name: norm,
    profile_json: profile ? JSON.stringify(profile) : language.profile_json,
    updated_at: nowIso()
  });
  await logActivity(deps.store, {
    workspaceId,
    actorUserId: req.userEmail,
    action: "language.renamed",
    resourceType: "language",
    resourceId: language.id,
    metadata: { name: body.name }
  });
  return ok({ message: "Language renamed.", name: body.name });
}

function safeParseStages(job: JobRow): unknown {
  try {
    return JSON.parse(job.stages_json);
  } catch {
    return [];
  }
}
