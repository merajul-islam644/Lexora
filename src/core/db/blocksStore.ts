import type { EntryRow, LanguageRow, JobRow } from "./rows.js";
import { uid } from "./ids.js";
import { getBlocksClient } from "../services/blocksClient.js";
import type { BlocksClient } from "@seliseblocks/client";
import type {
  ActivityListResult, DataStore, EntryListOpts, EntryListResult, MembershipRow,
  PhraseRow, ProgressRow, VersionRow, WorkspaceCoreRow, WorkspaceSummaryRow
} from "./store.js";

/* Blocks Data Gateway-backed DataStore. Domain data (workspaces, languages,
   dictionary, jobs, activity, phrasebook, progress) lives in the project's
   Blocks project; users/sessions stay local. Row shape (snake_case, as the
   DTO mappers expect) is mapped to/from the Blocks schema's camelCase fields.
   System fields: id<->ItemId, created_at<->CreatedDate, updated_at<->LastUpdatedDate.

   Query strategy: equality filters go to the gateway; search text, extra
   filtering and sorting happen in Node -- per-workspace dictionaries are
   small, and this keeps behavior identical to the SQL implementation. */

const PAGE = 500;

type Rec = Record<string, unknown>;

function unwrap(res: unknown): { items: Rec[]; totalCount: number } {
  const data = (res as { data?: Rec }).data;
  const payload = data ? data[Object.keys(data)[0]] : undefined;
  return { items: ((payload as Rec)?.items ?? []) as Rec[], totalCount: Number((payload as Rec)?.totalCount ?? 0) };
}

async function listAll(getClient: () => BlocksClient, schema: string, fields: string[], filter: Rec): Promise<Rec[]> {
  const col = getClient().data.collection<Rec>(schema);
  const out: Rec[] = [];
  let pageNo = 1;
  for (;;) {
    const res = await col.list({ filter, fields: [...fields], pageNo, pageSize: PAGE });
    const { items, totalCount } = unwrap(res);
    out.push(...items);
    if (out.length >= totalCount || items.length === 0) break;
    pageNo += 1;
  }
  return out;
}

async function insertRec(getClient: () => BlocksClient, schema: string, rec: Rec): Promise<void> {
  // Omit null fields on create: absent means null to the gateway, and some
  // nullable inputs reject explicit nulls on insert.
  const payload = Object.fromEntries(Object.entries(rec).filter(([, v]) => v !== null && v !== undefined));
  await getClient().data.collection<Rec>(schema).create(payload);
}

async function updateRec(getClient: () => BlocksClient, schema: string, itemId: string, rec: Rec): Promise<void> {
  const payload = Object.fromEntries(Object.entries(rec).filter(([k]) => k !== "ItemId"));
  await getClient().data.collection<Rec>(schema).update(itemId, payload);
}

async function deleteWhere(getClient: () => BlocksClient, schema: string, filter: Rec): Promise<void> {
  const items = await listAll(getClient, schema, ["ItemId"], filter);
  const col = getClient().data.collection<Rec>(schema);
  for (const item of items) {
    await col.delete(item.ItemId as string, { hardDelete: true });
  }
}

const ACTIVITY_FIELDS = ["workspaceId", "actorUserId", "action", "resourceType", "resourceId", "metadataJson"];
const ENTRY_FIELDS = [
  "workspaceId", "languageId", "word", "normalizedWord", "bengaliMeaning", "englishMeaning",
  "pronunciationGuide", "ipa", "partOfSpeech", "root", "wordFormationExplanation", "prefixes",
  "suffixes", "grammarNotes", "exampleSentencesJson", "relatedWordIds", "mnemonic", "learningStatus",
  "source", "status", "archived", "entryVersion", "historyJson"
];
const JOB_FIELDS = ["workspaceId", "userId", "status", "style", "referenceLangs", "preferredName", "stagesJson", "resultJson", "error", "finishedAt"];
const LANGUAGE_FIELDS = ["workspaceId", "name", "normalizedName", "description", "status", "version", "profileJson"];
const MEMBERSHIP_FIELDS = ["workspaceId", "userId", "role"];
const PHRASE_FIELDS = ["workspaceId", "sourceText", "sourceLang", "translatedText", "targetLang", "note"];
const PROGRESS_FIELDS = ["workspaceId", "userId", "languageId", "dictionaryEntryId", "status", "lastReviewedAt", "nextReviewAt", "correctCount", "incorrectCount", "intervalDays"];
const VERSION_FIELDS = ["workspaceId", "languageId", "version", "snapshotJson", "changeSummary", "authorUserId"];
const WORKSPACE_FIELDS = ["name", "normalizedName", "ownerUserId", "organizationId", "isDemo"];

const SYSTEM = ["ItemId", "CreatedDate", "LastUpdatedDate"];

/* --------------------------------- mappers -------------------------------- */

function baseRow(rec: Rec): { id: string; created_at: string; updated_at: string } {
  return {
    id: rec.ItemId as string,
    created_at: (rec.CreatedDate as string) ?? "",
    updated_at: (rec.LastUpdatedDate as string) ?? (rec.CreatedDate as string) ?? ""
  };
}

function recordToEntry(rec: Rec): EntryRow {
  return {
    ...baseRow(rec),
    workspace_id: rec.workspaceId as string,
    language_id: (rec.languageId as string) ?? null,
    word: rec.word as string,
    normalized_word: rec.normalizedWord as string,
    bengali_meaning: rec.bengaliMeaning as string,
    english_meaning: rec.englishMeaning as string,
    pronunciation_guide: rec.pronunciationGuide as string,
    ipa: rec.ipa as string,
    part_of_speech: rec.partOfSpeech as string,
    root: rec.root as string,
    word_formation_explanation: rec.wordFormationExplanation as string,
    prefixes: rec.prefixes as string,
    suffixes: rec.suffixes as string,
    grammar_notes: rec.grammarNotes as string,
    example_sentences_json: rec.exampleSentencesJson as string,
    related_word_ids_json: JSON.stringify(rec.relatedWordIds ?? []),
    mnemonic: rec.mnemonic as string,
    learning_status: rec.learningStatus as EntryRow["learning_status"],
    source: rec.source as EntryRow["source"],
    status: rec.status as EntryRow["status"],
    archived: rec.archived ? 1 : 0,
    entry_version: Number(rec.entryVersion ?? 1),
    history_json: rec.historyJson as string
  };
}

function entryToRecord(row: EntryRow, withSystem: boolean): Rec {
  const rec: Rec = {
    workspaceId: row.workspace_id,
    languageId: row.language_id ?? null,
    word: row.word,
    normalizedWord: row.normalized_word,
    bengaliMeaning: row.bengali_meaning,
    englishMeaning: row.english_meaning,
    pronunciationGuide: row.pronunciation_guide,
    ipa: row.ipa,
    partOfSpeech: row.part_of_speech,
    root: row.root,
    wordFormationExplanation: row.word_formation_explanation,
    prefixes: row.prefixes,
    suffixes: row.suffixes,
    grammarNotes: row.grammar_notes,
    exampleSentencesJson: row.example_sentences_json,
    relatedWordIds: safeArray(row.related_word_ids_json),
    mnemonic: row.mnemonic,
    learningStatus: row.learning_status,
    source: row.source,
    status: row.status,
    archived: Boolean(row.archived),
    entryVersion: row.entry_version,
    historyJson: row.history_json
  };
  if (withSystem) rec.ItemId = row.id;
  return rec;
}

function recordToLanguage(rec: Rec): LanguageRow {
  return {
    ...baseRow(rec),
    workspace_id: rec.workspaceId as string,
    name: rec.name as string,
    normalized_name: rec.normalizedName as string,
    description: rec.description as string,
    status: rec.status as string,
    version: Number(rec.version ?? 1),
    profile_json: rec.profileJson as string
  };
}

function languageToRecord(row: LanguageRow, withSystem: boolean): Rec {
  const rec: Rec = {
    workspaceId: row.workspace_id,
    name: row.name,
    normalizedName: row.normalized_name,
    description: row.description,
    status: row.status,
    version: row.version,
    profileJson: row.profile_json
  };
  if (withSystem) rec.ItemId = row.id;
  return rec;
}

function recordToJob(rec: Rec): JobRow {
  return {
    ...baseRow(rec),
    workspace_id: rec.workspaceId as string,
    user_id: rec.userId as string,
    status: rec.status as JobRow["status"],
    stages_json: rec.stagesJson as string,
    result_json: (rec.resultJson as string) ?? null,
    error: (rec.error as string) ?? null,
    style: rec.style as string,
    reference_langs: rec.referenceLangs as string,
    preferred_name: (rec.preferredName as string) ?? null,
    finished_at: (rec.finishedAt as string) ?? null
  };
}

function jobToRecord(row: JobRow, withSystem: boolean): Rec {
  const rec: Rec = {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    status: row.status,
    style: row.style,
    referenceLangs: row.reference_langs,
    preferredName: row.preferred_name ?? null,
    stagesJson: row.stages_json,
    resultJson: row.result_json ?? null,
    error: row.error ?? null,
    finishedAt: row.finished_at ?? null
  };
  if (withSystem) rec.ItemId = row.id;
  return rec;
}

function safeArray(json: string): string[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/* --------------------------------- store ---------------------------------- */

/* getClient defaults to the server's M2M client; the Blocks Function passes a
   per-request client built on the caller's token instead. */
export function blocksStore(getClient: () => BlocksClient = getBlocksClient): DataStore {
  const listAll_ = (schema: string, fields: string[], filter: Rec) => listAll(getClient, schema, fields, filter);
  const insertRec_ = (schema: string, rec: Rec) => insertRec(getClient, schema, rec);
  const updateRec_ = (schema: string, itemId: string, rec: Rec) => updateRec(getClient, schema, itemId, rec);
  const deleteWhere_ = (schema: string, filter: Rec) => deleteWhere(getClient, schema, filter);

  return {
    /* ------------------------------ dictionary ------------------------------ */

    async listEntries(workspaceId, opts): Promise<EntryListResult> {
      const recs = await listAll_("DictionaryEntry", [...ENTRY_FIELDS, ...SYSTEM], { workspaceId, archived: false });
      let rows = recs.map(recordToEntry);
      if (opts.q) {
        const q = opts.q.toLowerCase();
        rows = rows.filter((r) =>
          [r.word, r.bengali_meaning, r.english_meaning, r.root].some((v) => (v ?? "").toLowerCase().includes(q))
        );
      }
      if (opts.pos) rows = rows.filter((r) => r.part_of_speech === opts.pos);
      if (opts.learning) rows = rows.filter((r) => r.learning_status === opts.learning);
      if (opts.source) rows = rows.filter((r) => r.source === opts.source);
      rows.sort((a, b) => {
        if (opts.sort === "newest") return b.created_at.localeCompare(a.created_at);
        if (opts.sort === "updated") return b.updated_at.localeCompare(a.updated_at);
        if (opts.sort === "needs_revision") {
          const ar = a.learning_status === "needs_revision" ? 0 : 1;
          const br = b.learning_status === "needs_revision" ? 0 : 1;
          return ar - br || b.updated_at.localeCompare(a.updated_at);
        }
        return a.word.localeCompare(b.word, undefined, { sensitivity: "base" });
      });
      return { rows: rows.slice(opts.offset, opts.offset + opts.limit), total: rows.length };
    },

    async getEntryById(id, workspaceId, opts) {
      const recs = await listAll_("DictionaryEntry", [...ENTRY_FIELDS, ...SYSTEM], { workspaceId, ItemId: id });
      const row = recs.map(recordToEntry).find((r) => opts?.includeArchived || r.archived === 0);
      return row;
    },

    async findEntries(workspaceId, opts) {
      const recs = await listAll_("DictionaryEntry", [...ENTRY_FIELDS, ...SYSTEM], { workspaceId });
      return recs.map(recordToEntry).filter((r) => opts?.includeArchived || r.archived === 0);
    },

    async findEntryByNormalized(workspaceId, normalizedWord, opts) {
      const recs = await listAll_("DictionaryEntry", [...ENTRY_FIELDS, ...SYSTEM], { workspaceId });
      return recs
        .map(recordToEntry)
        .find((r) => r.normalized_word === normalizedWord && r.id !== opts?.excludeId && (opts?.includeArchived || r.archived === 0));
    },

    async recentEntries(workspaceId, limit) {
      const recs = await listAll_("DictionaryEntry", [...ENTRY_FIELDS, ...SYSTEM], { workspaceId, archived: false });
      return recs
        .map(recordToEntry)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, limit);
    },

    async insertEntry(row) {
      await insertRec_("DictionaryEntry", entryToRecord(row, true));
    },

    async updateEntry(workspaceId, id, patch) {
      const current = await this.getEntryById(id, workspaceId, { includeArchived: true });
      if (!current) return;
      const merged = { ...current, ...patch } as EntryRow;
      await updateRec_("DictionaryEntry", id, entryToRecord(merged, false));
    },

    async countEntries(workspaceId, opts) {
      const recs = await listAll_("DictionaryEntry", ["ItemId"], { workspaceId, archived: false });
      if (!opts?.withReference && !opts?.approvedOnly) return recs.length;
      const full = await listAll_("DictionaryEntry", [...ENTRY_FIELDS, ...SYSTEM], { workspaceId, archived: false });
      return full
        .map(recordToEntry)
        .filter((r) => (!opts.withReference || r.bengali_meaning !== "" || r.english_meaning !== "") && (!opts.approvedOnly || r.status === "approved"))
        .length;
    },

    async lastEntryUpdated(workspaceId) {
      const recs = await listAll_("DictionaryEntry", ["LastUpdatedDate"], { workspaceId });
      if (recs.length === 0) return null;
      return recs
        .map((r) => (r.LastUpdatedDate as string) ?? "")
        .reduce((a, b) => (b.localeCompare(a) > 0 ? b : a));
    },

    async linkEntriesToLanguage(workspaceId, languageId) {
      const recs = await listAll_("DictionaryEntry", [...ENTRY_FIELDS, ...SYSTEM], { workspaceId });
      for (const rec of recs) {
        if (!rec.languageId) {
          await updateRec_("DictionaryEntry", rec.ItemId as string, { languageId });
        }
      }
    },

    async setEntryLearning(id, status, updatedAt) {
      await updateRec_("DictionaryEntry", id, { learningStatus: status, LastUpdatedDate: updatedAt });
    },

    /* ------------------------------ workspaces ------------------------------ */

    async getWorkspace(id) {
      const recs = await listAll_("Workspace", [...WORKSPACE_FIELDS, ...SYSTEM], { ItemId: id });
      const rec = recs[0];
      if (!rec) return undefined;
      return {
        id: rec.ItemId as string,
        name: rec.name as string,
        organization_id: (rec.organizationId as string) ?? "",
        is_demo: rec.isDemo ? 1 : 0,
        created_at: (rec.CreatedDate as string) ?? ""
      };
    },

    async insertWorkspace(row) {
      await insertRec_("Workspace", {
        ItemId: row.id,
        name: row.name,
        normalizedName: row.normalized_name,
        ownerUserId: row.owner_user_id,
        organizationId: row.organization_id,
        isDemo: Boolean(row.is_demo)
      });
    },

    async renameWorkspace(id, name, normalized_name, updatedAt) {
      await updateRec_("Workspace", id, { name, normalizedName: normalized_name, LastUpdatedDate: updatedAt });
    },

    async deleteWorkspace(id) {
      // Replicate the SQL FK cascades. language rows keep their entries' languageId
      // dangling after a workspace delete, same as the SQL "ON DELETE CASCADE"
      // leaves nothing behind -- children go first, then the workspace.
      for (const [schema, field] of [
        ["WorkspaceMembership", "workspaceId"],
        ["LanguageVersion", "workspaceId"],
        ["LearningProgress", "workspaceId"],
        ["ActivityLog", "workspaceId"],
        ["Phrasebook", "workspaceId"],
        ["GenerationJob", "workspaceId"],
        ["DictionaryEntry", "workspaceId"],
        ["Language", "workspaceId"]
      ] as const) {
        await deleteWhere_(schema, { [field]: id });
      }
      await getClient().data.collection<Rec>("Workspace").delete(id, { hardDelete: true });
    },

    async listWorkspaceSummaries(userId): Promise<WorkspaceSummaryRow[]> {
      const memberships = await listAll_("WorkspaceMembership", [...MEMBERSHIP_FIELDS, ...SYSTEM], { userId });
      const out: WorkspaceSummaryRow[] = [];
      for (const m of memberships) {
        const workspaceId = m.workspaceId as string;
        const [wsRecs, langRecs, count] = await Promise.all([
          listAll_("Workspace", [...WORKSPACE_FIELDS, ...SYSTEM], { ItemId: workspaceId }),
          listAll_("Language", ["name", "ItemId"], { workspaceId }),
          listAll_("DictionaryEntry", ["ItemId"], { workspaceId, archived: false })
        ]);
        const ws = wsRecs[0];
        if (!ws) continue;
        out.push({
          id: workspaceId,
          name: ws.name as string,
          organization_id: (ws.organizationId as string) ?? "",
          is_demo: ws.isDemo ? 1 : 0,
          // TODO(iam-roles): local workspace role fallback, not an IAM role
          role: (m.role as string) ?? "viewer",
          created_at: (ws.CreatedDate as string) ?? "",
          language_name: (langRecs[0]?.name as string) ?? null,
          word_count: count.length
        });
      }
      out.sort((a, b) => a.created_at.localeCompare(b.created_at));
      return out;
    },

    /* ------------------------------ memberships ----------------------------- */

    async getMembership(workspaceId, userId) {
      const recs = await listAll_("WorkspaceMembership", [...MEMBERSHIP_FIELDS], { workspaceId, userId });
      return recs[0] ? { role: recs[0].role as string } : undefined;
    },

    async insertMembership(row) {
      await insertRec_("WorkspaceMembership", {
        ItemId: row.id,
        workspaceId: row.workspace_id,
        userId: row.user_id,
        role: row.role
      });
    },

    async updateMembershipRole(workspaceId, userId, role) {
      const recs = await listAll_("WorkspaceMembership", ["ItemId"], { workspaceId, userId });
      if (recs[0]) await updateRec_("WorkspaceMembership", recs[0].ItemId as string, { role });
    },

    async deleteMembership(workspaceId, userId) {
      await deleteWhere_("WorkspaceMembership", { workspaceId, userId });
    },

    async listMemberships(workspaceId) {
      const recs = await listAll_("WorkspaceMembership", [...MEMBERSHIP_FIELDS, ...SYSTEM], { workspaceId });
      return recs
        .map((rec) => ({
          id: rec.ItemId as string,
          workspace_id: rec.workspaceId as string,
          user_id: rec.userId as string,
          role: rec.role as string,
          created_at: (rec.CreatedDate as string) ?? ""
        }))
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
    },

    /* -------------------------------- language ------------------------------- */

    async getLanguageByWorkspace(workspaceId) {
      const recs = await listAll_("Language", [...LANGUAGE_FIELDS, ...SYSTEM], { workspaceId });
      const rec = recs[0];
      return rec ? recordToLanguage(rec) : undefined;
    },

    async getLanguageById(id) {
      const recs = await listAll_("Language", [...LANGUAGE_FIELDS, ...SYSTEM], { ItemId: id });
      return recs[0] ? recordToLanguage(recs[0]) : undefined;
    },

    async insertLanguage(row) {
      await insertRec_("Language", languageToRecord(row, true));
    },

    async updateLanguage(id, patch) {
      const current = await this.getLanguageById(id);
      if (!current) return;
      await updateRec_("Language", id, languageToRecord({ ...current, ...patch } as LanguageRow, false));
    },

    async listLanguageNormalizedNames() {
      const recs = await listAll_("Language", ["normalizedName"], {});
      return recs.map((r) => String(r.normalizedName ?? "").toLowerCase());
    },

    /* --------------------------- language versions --------------------------- */

    async listVersions(languageId) {
      const recs = await listAll_("LanguageVersion", [...VERSION_FIELDS, ...SYSTEM], { languageId });
      return recs
        .map((rec) => ({
          id: rec.ItemId as string,
          workspace_id: rec.workspaceId as string,
          language_id: rec.languageId as string,
          version: Number(rec.version ?? 0),
          snapshot_json: rec.snapshotJson as string,
          change_summary: rec.changeSummary as string,
          created_by: rec.authorUserId as string,
          created_at: (rec.CreatedDate as string) ?? ""
        }))
        .sort((a, b) => b.version - a.version);
    },

    async getVersion(languageId, version) {
      const recs = await listAll_("LanguageVersion", [...VERSION_FIELDS, ...SYSTEM], { languageId });
      const rec = recs.find((r) => Number(r.version) === version);
      if (!rec) return undefined;
      return {
        id: rec.ItemId as string,
        workspace_id: rec.workspaceId as string,
        language_id: rec.languageId as string,
        version: Number(rec.version ?? 0),
        snapshot_json: rec.snapshotJson as string,
        change_summary: rec.changeSummary as string,
        created_by: rec.authorUserId as string,
        created_at: (rec.CreatedDate as string) ?? ""
      };
    },

    async insertVersion(row) {
      await insertRec_("LanguageVersion", {
        ItemId: row.id,
        workspaceId: row.workspace_id,
        languageId: row.language_id,
        version: row.version,
        snapshotJson: row.snapshot_json,
        changeSummary: row.change_summary,
        authorUserId: row.created_by
      });
    },

    /* --------------------------- generation jobs ----------------------------- */

    async getJob(id) {
      const recs = await listAll_("GenerationJob", [...JOB_FIELDS, ...SYSTEM], { ItemId: id });
      const rec = recs[0];
      return rec ? recordToJob(rec) : undefined;
    },

    async getActiveJob(workspaceId) {
      const recs = await listAll_("GenerationJob", ["ItemId", "status", "CreatedDate"], { workspaceId });
      const active = recs
        .filter((r) => r.status === "queued" || r.status === "running")
        .sort((a, b) => String(b.CreatedDate ?? "").localeCompare(String(a.CreatedDate ?? "")));
      return active[0] ? { id: active[0].ItemId as string } : undefined;
    },

    async countJobs(workspaceId) {
      const recs = await listAll_("GenerationJob", ["ItemId"], { workspaceId });
      return recs.length;
    },

    async insertJob(row) {
      await insertRec_("GenerationJob", jobToRecord(row, true));
    },

    async updateJob(id, patch) {
      const current = await this.getJob(id);
      if (!current) return;
      await updateRec_("GenerationJob", id, jobToRecord({ ...current, ...patch } as JobRow, false));
    },

    /* -------------------------------- activity ------------------------------- */

    async insertActivity(row) {
      await insertRec_("ActivityLog", {
        ItemId: row.id,
        workspaceId: row.workspace_id,
        actorUserId: row.actor_user_id ?? null,
        action: row.action,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        metadataJson: row.metadata_json
      });
    },

    async listActivity(workspaceId, limit, offset): Promise<ActivityListResult> {
      const recs = await listAll_("ActivityLog", [...ACTIVITY_FIELDS, ...SYSTEM], { workspaceId });
      const rows = recs
        .map((rec) => ({
          id: rec.ItemId as string,
          workspace_id: rec.workspaceId as string,
          actor_user_id: (rec.actorUserId as string) ?? null,
          action: rec.action as string,
          resource_type: rec.resourceType as string,
          resource_id: rec.resourceId as string,
          metadata_json: rec.metadataJson as string,
          created_at: (rec.CreatedDate as string) ?? ""
        }))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      return { rows: rows.slice(offset, offset + limit), total: rows.length };
    },

    async countActivity(workspaceId, action) {
      const recs = await listAll_("ActivityLog", ["action"], { workspaceId });
      return action ? recs.filter((r) => r.action === action).length : recs.length;
    },

    /* -------------------------------- phrasebook ----------------------------- */

    async listPhrasebook(workspaceId, limit) {
      const recs = await listAll_("Phrasebook", [...PHRASE_FIELDS, ...SYSTEM], { workspaceId });
      return recs
        .map((rec) => ({
          id: rec.ItemId as string,
          workspace_id: rec.workspaceId as string,
          source_text: rec.sourceText as string,
          source_lang: rec.sourceLang as string,
          translated_text: rec.translatedText as string,
          target_lang: rec.targetLang as string,
          note: (rec.note as string) ?? "",
          created_at: (rec.CreatedDate as string) ?? ""
        }))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit);
    },

    async insertPhrasebook(row) {
      await insertRec_("Phrasebook", {
        ItemId: row.id,
        workspaceId: row.workspace_id,
        sourceText: row.source_text,
        sourceLang: row.source_lang,
        translatedText: row.translated_text,
        targetLang: row.target_lang,
        note: row.note
      });
    },

    async deletePhrasebook(id, workspaceId) {
      await deleteWhere_("Phrasebook", { workspaceId, ItemId: id });
    },

    /* ---------------------------- learning progress -------------------------- */

    async getProgress(userId, entryId) {
      const recs = await listAll_("LearningProgress", [...PROGRESS_FIELDS, ...SYSTEM], { userId, dictionaryEntryId: entryId });
      const rec = recs[0];
      if (!rec) return undefined;
      return {
        id: rec.ItemId as string,
        workspace_id: rec.workspaceId as string,
        user_id: rec.userId as string,
        language_id: (rec.languageId as string) ?? null,
        dictionary_entry_id: rec.dictionaryEntryId as string,
        status: rec.status as string,
        last_reviewed_at: (rec.lastReviewedAt as string) ?? null,
        next_review_at: (rec.nextReviewAt as string) ?? null,
        correct_count: Number(rec.correctCount ?? 0),
        incorrect_count: Number(rec.incorrectCount ?? 0),
        interval_days: Number(rec.intervalDays ?? 0),
        updated_at: (rec.LastUpdatedDate as string) ?? ""
      };
    },

    async upsertProgress(row) {
      const rec: Rec = {
        workspaceId: row.workspace_id,
        userId: row.user_id,
        languageId: row.language_id ?? null,
        dictionaryEntryId: row.dictionary_entry_id,
        status: row.status,
        lastReviewedAt: row.last_reviewed_at ?? null,
        nextReviewAt: row.next_review_at ?? null,
        correctCount: row.correct_count,
        incorrectCount: row.incorrect_count,
        intervalDays: row.interval_days
      };
      if (await this.getProgress(row.user_id, row.dictionary_entry_id)) {
        await updateRec_("LearningProgress", row.id, rec);
      } else {
        await insertRec_("LearningProgress", { ItemId: row.id, ...rec });
      }
    },

    async listProgress(workspaceId, userId) {
      const recs = await listAll_("LearningProgress", [...PROGRESS_FIELDS, ...SYSTEM], { workspaceId, userId });
      return recs.map((rec) => ({
        id: rec.ItemId as string,
        workspace_id: rec.workspaceId as string,
        user_id: rec.userId as string,
        language_id: (rec.languageId as string) ?? null,
        dictionary_entry_id: rec.dictionaryEntryId as string,
        status: rec.status as string,
        last_reviewed_at: (rec.lastReviewedAt as string) ?? null,
        next_review_at: (rec.nextReviewAt as string) ?? null,
        correct_count: Number(rec.correctCount ?? 0),
        incorrect_count: Number(rec.incorrectCount ?? 0),
        interval_days: Number(rec.intervalDays ?? 0),
        updated_at: (rec.LastUpdatedDate as string) ?? ""
      }));
    },

    /* -------------------------------- avatar ---------------------------------- */

    async getAvatarFileId(userId) {
      // A missing/unreadable UserProfile schema means "no avatar set" — never
      // a page-load failure (the schema is provisioned via blocks/data/schemas).
      try {
        const recs = await listAll_("UserProfile", ["ItemId", "userId", "avatarFileId"], { userId });
        return (recs[0]?.avatarFileId as string) || null;
      } catch {
        return null;
      }
    },

    async setAvatarFileId(userId, fileId) {
      let recs: Rec[] = [];
      try {
        recs = await listAll_("UserProfile", ["ItemId"], { userId });
      } catch {
        recs = [];
      }
      if (recs[0]) {
        await updateRec_("UserProfile", recs[0].ItemId as string, { avatarFileId: fileId });
      } else {
        await insertRec_("UserProfile", { ItemId: uid(), userId, avatarFileId: fileId });
      }
    }
  };
}
