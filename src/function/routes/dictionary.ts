import { uid, nowIso, normalizeWord } from "../../core/db/ids.js";
import { toEntryDTO } from "../../core/db/rows.js";
import { parseBody, pageParams } from "../../core/lib/validate.js";
import { dictionaryEntrySchema, entryUpdateSchema, importPreviewSchema, importCommitSchema } from "../../shared/schemas.js";
import { logActivity } from "../../core/services/activity.js";
import { conflict, notFound } from "../../core/lib/errors.js";
import {
  parseCsv, gridToImportRows, jsonToImportRows, buildImportReport, commitImport, exportEntries, CSV_TEMPLATE_HEADERS
} from "../../core/services/importExport.js";
import type { EntryRow } from "../../core/db/rows.js";
import type { ApiDeps, ApiRequest, ApiResponse } from "../support.js";
import { created, ok, requireWorkspace } from "../support.js";

/* Dictionary domain: list/search, CRUD (soft archive), history, CSV/JSON
   import and export. Ported from the Express dictionary routes. */

export async function listEntries(deps: ApiDeps, req: ApiRequest, workspaceId: string): Promise<ApiResponse> {
  const { page, pageSize, offset } = pageParams(req.query, 20, 100);
  const sort = req.query.sort ?? "alpha";
  const result = await deps.store.listEntries(workspaceId, {
    q: req.query.q ?? "",
    pos: req.query.pos ?? "",
    learning: req.query.learning ?? "",
    source: req.query.source ?? "",
    sort: (["alpha", "newest", "updated", "needs_revision"] as const).includes(sort as "alpha")
      ? (sort as "alpha" | "newest" | "updated" | "needs_revision")
      : "alpha",
    limit: pageSize,
    offset
  });
  return ok({ total: result.total, page, pageSize, items: result.rows.map(toEntryDTO) });
}

export async function getTemplate(): Promise<ApiResponse> {
  return ok({ headers: CSV_TEMPLATE_HEADERS });
}

export async function exportDictionary(deps: ApiDeps, req: ApiRequest, workspaceId: string): Promise<ApiResponse> {
  const format = req.query.format === "json" ? "json" : "csv";
  const file = await exportEntries(deps.store, workspaceId, format);
  await logActivity(deps.store, {
    workspaceId,
    actorUserId: req.userEmail,
    action: "dictionary.exported",
    resourceType: "dictionary",
    resourceId: workspaceId,
    metadata: { format }
  });
  // The SPA builds the download client-side from this envelope.
  return ok({ filename: file.filename, contentType: file.contentType, content: file.body });
}

export async function importPreview(deps: ApiDeps, req: ApiRequest, workspaceId: string): Promise<ApiResponse> {
  await requireWorkspace(deps, workspaceId, req.userEmail, "editor", "dictionary:import");
  const body = parseBody(importPreviewSchema, req.body);
  const rows = body.format === "csv" ? gridToImportRows(parseCsv(body.content)) : jsonToImportRows(body.content);
  if (rows.headerErrors.length > 0) {
    return { statusCode: 400, body: { error: { code: "bad_request", message: rows.headerErrors.join(" ") } } };
  }
  const report = await buildImportReport(deps.store, workspaceId, rows.rows);
  return ok({ report });
}

export async function importCommit(deps: ApiDeps, req: ApiRequest, workspaceId: string): Promise<ApiResponse> {
  await requireWorkspace(deps, workspaceId, req.userEmail, "editor", "dictionary:import");
  const body = parseBody(importCommitSchema, req.body);
  const result = await commitImport(deps.store, workspaceId, req.userEmail, body.rows);
  return ok(result);
}

export async function getEntry(deps: ApiDeps, req: ApiRequest, workspaceId: string, entryId: string): Promise<ApiResponse> {
  const entry = await deps.store.getEntryById(entryId, workspaceId);
  if (!entry) throw notFound("Word not found");
  return ok({ entry: toEntryDTO(entry) });
}

export async function createEntry(deps: ApiDeps, req: ApiRequest, workspaceId: string): Promise<ApiResponse> {
  await requireWorkspace(deps, workspaceId, req.userEmail, "editor", "dictionary:write");
  const body = parseBody(dictionaryEntrySchema, req.body);
  const norm = normalizeWord(body.word);
  const dup = await deps.store.findEntryByNormalized(workspaceId, norm);
  if (dup) {
    throw conflict(`"${dup.word}" already exists in this dictionary.`, { existingId: dup.id, existingWord: dup.word });
  }
  const id = uid();
  const now = nowIso();
  const language = await deps.store.getLanguageByWorkspace(workspaceId);
  await deps.store.insertEntry({
    id,
    workspace_id: workspaceId,
    language_id: language?.id ?? null,
    word: body.word,
    normalized_word: norm,
    bengali_meaning: body.bengaliMeaning ?? "",
    english_meaning: body.englishMeaning ?? "",
    pronunciation_guide: body.pronunciationGuide ?? "",
    ipa: body.ipa ?? "",
    part_of_speech: body.partOfSpeech ?? "noun",
    root: body.root ?? "",
    word_formation_explanation: body.wordFormationExplanation ?? "",
    prefixes: "",
    suffixes: "",
    grammar_notes: body.grammarNotes ?? "",
    example_sentences_json: JSON.stringify(body.exampleSentences ?? []),
    related_word_ids_json: "[]",
    mnemonic: body.mnemonic ?? "",
    learning_status: "new",
    source: "user",
    status: body.status ?? "approved",
    archived: 0,
    entry_version: 1,
    history_json: "[]",
    created_at: now,
    updated_at: now
  });
  await logActivity(deps.store, {
    workspaceId,
    actorUserId: req.userEmail,
    action: "dictionary.word_added",
    resourceType: "dictionary_entry",
    resourceId: id,
    metadata: { word: body.word }
  });
  const entry = await deps.store.getEntryById(id, workspaceId);
  if (!entry) throw notFound("Word not found");
  return created({ entry: toEntryDTO(entry) });
}

export async function updateEntry(deps: ApiDeps, req: ApiRequest, workspaceId: string, entryId: string): Promise<ApiResponse> {
  await requireWorkspace(deps, workspaceId, req.userEmail, "editor", "dictionary:write");
  const entry = await deps.store.getEntryById(entryId, workspaceId);
  if (!entry) throw notFound("Word not found");
  const body = parseBody(entryUpdateSchema, req.body);

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const updatable: Array<[keyof typeof body, keyof EntryRow]> = [
    ["word", "word"], ["bengaliMeaning", "bengali_meaning"], ["englishMeaning", "english_meaning"],
    ["pronunciationGuide", "pronunciation_guide"], ["ipa", "ipa"], ["partOfSpeech", "part_of_speech"],
    ["root", "root"], ["wordFormationExplanation", "word_formation_explanation"],
    ["prefixes", "prefixes"], ["suffixes", "suffixes"], ["grammarNotes", "grammar_notes"],
    ["mnemonic", "mnemonic"], ["status", "status"], ["learningStatus", "learning_status"]
  ];
  const patch: Partial<EntryRow> = {};
  for (const [field, column] of updatable) {
    const value = body[field];
    if (value === undefined) continue;
    const current = entry[column];
    if (value !== current) {
      changes[field as string] = { from: current, to: value };
    }
    (patch as Record<string, unknown>)[column] = value;
  }
  if (body.exampleSentences !== undefined) {
    const current = JSON.parse(entry.example_sentences_json) as unknown;
    if (JSON.stringify(current) !== JSON.stringify(body.exampleSentences)) {
      changes.exampleSentences = { from: current, to: body.exampleSentences };
    }
    patch.example_sentences_json = JSON.stringify(body.exampleSentences);
  }
  if (Object.keys(patch).length === 0) {
    return ok({ entry: toEntryDTO(entry), message: "Nothing to update." });
  }

  if (body.word !== undefined) {
    const norm = normalizeWord(body.word);
    const dup = await deps.store.findEntryByNormalized(workspaceId, norm, { excludeId: entry.id });
    if (dup) throw conflict(`"${body.word}" already exists in this dictionary.`, { existingWord: body.word });
    patch.normalized_word = norm;
  }

  const history = JSON.parse(entry.history_json) as Array<unknown>;
  history.push({ at: nowIso(), changes });
  patch.entry_version = entry.entry_version + 1;
  patch.history_json = JSON.stringify(history);
  patch.updated_at = nowIso();
  await deps.store.updateEntry(workspaceId, entry.id, patch);

  await logActivity(deps.store, {
    workspaceId,
    actorUserId: req.userEmail,
    action: "dictionary.word_updated",
    resourceType: "dictionary_entry",
    resourceId: entry.id,
    metadata: { fields: Object.keys(changes) }
  });
  const updated = await deps.store.getEntryById(entry.id, workspaceId);
  if (!updated) throw notFound("Word not found");
  return ok({ entry: toEntryDTO(updated) });
}

export async function archiveEntry(deps: ApiDeps, req: ApiRequest, workspaceId: string, entryId: string): Promise<ApiResponse> {
  await requireWorkspace(deps, workspaceId, req.userEmail, "editor", "dictionary:write");
  const entry = await deps.store.getEntryById(entryId, workspaceId);
  if (!entry) throw notFound("Word not found");
  await deps.store.updateEntry(workspaceId, entry.id, { archived: 1, updated_at: nowIso() });
  await logActivity(deps.store, {
    workspaceId,
    actorUserId: req.userEmail,
    action: "dictionary.word_archived",
    resourceType: "dictionary_entry",
    resourceId: entry.id,
    metadata: { word: entry.word }
  });
  return ok({ message: `"${entry.word}" was archived. You can restore it.` });
}

export async function restoreEntry(deps: ApiDeps, req: ApiRequest, workspaceId: string, entryId: string): Promise<ApiResponse> {
  await requireWorkspace(deps, workspaceId, req.userEmail, "editor", "dictionary:write");
  const entry = await deps.store.getEntryById(entryId, workspaceId, { includeArchived: true });
  if (!entry) throw notFound("Word not found");
  await deps.store.updateEntry(workspaceId, entry.id, { archived: 0, updated_at: nowIso() });
  await logActivity(deps.store, {
    workspaceId,
    actorUserId: req.userEmail,
    action: "dictionary.word_restored",
    resourceType: "dictionary_entry",
    resourceId: entry.id,
    metadata: { word: entry.word }
  });
  return ok({ message: `"${entry.word}" was restored.` });
}

export async function getHistory(deps: ApiDeps, req: ApiRequest, workspaceId: string, entryId: string): Promise<ApiResponse> {
  const entry = await deps.store.getEntryById(entryId, workspaceId);
  if (!entry) throw notFound("Word not found");
  return ok({ history: JSON.parse(entry.history_json) as unknown[], version: entry.entry_version });
}
