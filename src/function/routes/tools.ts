import { uid, nowIso } from "../../core/db/ids.js";
import { parseBody } from "../../core/lib/validate.js";
import { suggestWordSchema, approveWordSchema, translateSchema, phrasebookAddSchema, practiceReviewSchema, PRACTICE_MODES } from "../../shared/schemas.js";
import { suggestWord, approveSuggestedWord } from "../../core/services/wordbuilder.js";
import { translate } from "../../core/services/translation.js";
import { getPracticeQueue, applyReview, getPracticeStats } from "../../core/services/practice.js";
import type { ApiDeps, ApiRequest, ApiResponse } from "../support.js";
import { created, ok, requireWorkspace } from "../support.js";

/* Tools: word builder, translation lab, phrasebook, practice. Ported from the
   Express tools routes. */

export async function suggestWordRoute(deps: ApiDeps, req: ApiRequest, workspaceId: string): Promise<ApiResponse> {
  await requireWorkspace(deps, workspaceId, req.userEmail, "editor", "dictionary:write");
  const body = parseBody(suggestWordSchema, req.body);
  const suggestion = await suggestWord(deps.store, workspaceId, body);
  return ok({ suggestion });
}

export async function approveWord(deps: ApiDeps, req: ApiRequest, workspaceId: string): Promise<ApiResponse> {
  await requireWorkspace(deps, workspaceId, req.userEmail, "editor", "dictionary:write");
  const body = parseBody(approveWordSchema, req.body);
  const saved = await approveSuggestedWord(deps.store, workspaceId, req.userEmail, body);
  return created(saved);
}

export async function translateRoute(deps: ApiDeps, req: ApiRequest, workspaceId: string): Promise<ApiResponse> {
  await requireWorkspace(deps, workspaceId, req.userEmail, "viewer", "dictionary:read");
  const body = parseBody(translateSchema, req.body);
  const result = await translate(deps.store, workspaceId, body);
  return ok(result);
}

export async function listPhrasebook(deps: ApiDeps, req: ApiRequest, workspaceId: string): Promise<ApiResponse> {
  await requireWorkspace(deps, workspaceId, req.userEmail, "viewer", "dictionary:read");
  const items = (await deps.store.listPhrasebook(workspaceId, 100)).map((r) => ({
    id: r.id,
    sourceText: r.source_text,
    sourceLang: r.source_lang,
    translatedText: r.translated_text,
    targetLang: r.target_lang,
    note: r.note ?? "",
    createdAt: r.created_at
  }));
  return ok({ items });
}

export async function addPhrase(deps: ApiDeps, req: ApiRequest, workspaceId: string): Promise<ApiResponse> {
  await requireWorkspace(deps, workspaceId, req.userEmail, "editor", "dictionary:write");
  const body = parseBody(phrasebookAddSchema, req.body);
  const id = uid();
  await deps.store.insertPhrasebook({
    id,
    workspace_id: workspaceId,
    source_text: body.sourceText,
    source_lang: body.sourceLang,
    translated_text: body.translatedText,
    target_lang: body.targetLang,
    note: body.note ?? "",
    created_at: nowIso()
  });
  return created({ id, message: "Saved to phrasebook." });
}

export async function removePhrase(deps: ApiDeps, req: ApiRequest, workspaceId: string, phraseId: string): Promise<ApiResponse> {
  await requireWorkspace(deps, workspaceId, req.userEmail, "editor", "dictionary:write");
  await deps.store.deletePhrasebook(phraseId, workspaceId);
  return ok({ message: "Removed from phrasebook." });
}

export async function practiceQueue(deps: ApiDeps, req: ApiRequest, workspaceId: string): Promise<ApiResponse> {
  await requireWorkspace(deps, workspaceId, req.userEmail, "viewer", "dictionary:read");
  const modeParam = req.query.mode ?? "mixed";
  const mode = (PRACTICE_MODES as readonly string[]).includes(modeParam) ? (modeParam as (typeof PRACTICE_MODES)[number]) : "mixed";
  const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 10));
  const [items, stats] = await Promise.all([
    getPracticeQueue(deps.store, workspaceId, req.userEmail, mode, limit),
    getPracticeStats(deps.store, workspaceId, req.userEmail)
  ]);
  return ok({ items, stats });
}

export async function practiceReview(deps: ApiDeps, req: ApiRequest, workspaceId: string): Promise<ApiResponse> {
  await requireWorkspace(deps, workspaceId, req.userEmail, "viewer", "dictionary:read");
  const body = parseBody(practiceReviewSchema, req.body);
  const result = await applyReview(deps.store, {
    workspaceId,
    userId: req.userEmail,
    entryId: body.entryId,
    mode: body.mode,
    correct: body.correct
  });
  return ok(result);
}

export async function practiceStats(deps: ApiDeps, req: ApiRequest, workspaceId: string): Promise<ApiResponse> {
  await requireWorkspace(deps, workspaceId, req.userEmail, "viewer", "dictionary:read");
  return ok({ stats: await getPracticeStats(deps.store, workspaceId, req.userEmail) });
}
