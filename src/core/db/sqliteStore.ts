import type { Db } from "./connection.js";
import type { EntryRow, LanguageRow, JobRow } from "./rows.js";
import type {
  ActivityListResult, ActivityRow, DataStore, EntryListOpts, EntryListResult, MembershipRow,
  PhraseRow, ProgressRow, VersionRow, WorkspaceCoreRow, WorkspaceSummaryRow
} from "./store.js";

/* SQLite-backed DataStore: the original storage, extracted verbatim from the
   routes/services it used to live in. Still the store for tests and offline
   dev; production runs blocksStore against the Blocks Data Gateway. */

export function sqliteStore(db: Db): DataStore {
  return {
    /* ------------------------------ dictionary ------------------------------ */

    async listEntries(workspaceId: string, opts: EntryListOpts): Promise<EntryListResult> {
      const where: string[] = ["workspace_id = ?", "archived = 0"];
      const params: (string | number)[] = [workspaceId];
      if (opts.q) {
        where.push("(word LIKE ? ESCAPE '\\' OR bengali_meaning LIKE ? ESCAPE '\\' OR english_meaning LIKE ? ESCAPE '\\' OR root LIKE ? ESCAPE '\\')");
        const like = `%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        params.push(like, like, like, like);
      }
      if (opts.pos) {
        where.push("part_of_speech = ?");
        params.push(opts.pos);
      }
      if (opts.learning) {
        where.push("learning_status = ?");
        params.push(opts.learning);
      }
      if (opts.source) {
        where.push("source = ?");
        params.push(opts.source);
      }
      const orderBy =
        opts.sort === "newest" ? "created_at DESC"
        : opts.sort === "updated" ? "updated_at DESC"
        : opts.sort === "needs_revision" ? "CASE WHEN learning_status = 'needs_revision' THEN 0 ELSE 1 END ASC, updated_at DESC"
        : "word COLLATE NOCASE ASC";
      const whereSql = where.join(" AND ");
      const total = (db.prepare(`SELECT COUNT(*) AS c FROM dictionary_entries WHERE ${whereSql}`).get(...params) as unknown as { c: number }).c;
      const rows = db
        .prepare(`SELECT * FROM dictionary_entries WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
        .all(...params, opts.limit, opts.offset) as unknown as EntryRow[];
      return { rows, total };
    },

    async getEntryById(id, workspaceId, opts): Promise<EntryRow | undefined> {
      return db
        .prepare(`SELECT * FROM dictionary_entries WHERE id = ? AND workspace_id = ? ${opts?.includeArchived ? "" : "AND archived = 0"}`)
        .get(id, workspaceId) as unknown as EntryRow | undefined;
    },

    async findEntries(workspaceId, opts) {
      return db
        .prepare(`SELECT * FROM dictionary_entries WHERE workspace_id = ? ${opts?.includeArchived ? "" : "AND archived = 0"}`)
        .all(workspaceId) as unknown as EntryRow[];
    },

    async findEntryByNormalized(workspaceId, normalizedWord, opts) {
      return db
        .prepare(
          `SELECT * FROM dictionary_entries WHERE workspace_id = ? AND normalized_word = ? ${opts?.excludeId ? "AND id != ?" : ""} ${opts?.includeArchived ? "" : "AND archived = 0"}`
        )
        .get(...(opts?.excludeId ? [workspaceId, normalizedWord, opts.excludeId] : [workspaceId, normalizedWord])) as unknown as EntryRow | undefined;
    },

    async recentEntries(workspaceId, limit) {
      return db
        .prepare("SELECT * FROM dictionary_entries WHERE workspace_id = ? AND archived = 0 ORDER BY updated_at DESC LIMIT ?")
        .all(workspaceId, limit) as unknown as EntryRow[];
    },

    async insertEntry(row) {
      db.prepare(
        `INSERT INTO dictionary_entries
         (id, workspace_id, language_id, word, normalized_word, bengali_meaning, english_meaning, pronunciation_guide, ipa,
          part_of_speech, root, word_formation_explanation, prefixes, suffixes, grammar_notes, example_sentences_json,
          related_word_ids_json, mnemonic, learning_status, source, status, archived, entry_version, history_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        row.id, row.workspace_id, row.language_id, row.word, row.normalized_word,
        row.bengali_meaning, row.english_meaning, row.pronunciation_guide, row.ipa,
        row.part_of_speech, row.root, row.word_formation_explanation, row.prefixes, row.suffixes,
        row.grammar_notes, row.example_sentences_json, row.related_word_ids_json, row.mnemonic,
        row.learning_status, row.source, row.status, row.archived, row.entry_version, row.history_json,
        row.created_at, row.updated_at
      );
    },

    async updateEntry(workspaceId, id, patch) {
      const cols = Object.keys(patch);
      if (cols.length === 0) return;
      const sets = cols.map((c) => `${c} = ?`).join(", ");
      const values = cols.map((c) => (patch as Record<string, unknown>)[c]) as Array<string | number>;
      db.prepare(`UPDATE dictionary_entries SET ${sets} WHERE id = ? AND workspace_id = ?`).run(...values, id, workspaceId);
    },

    async countEntries(workspaceId, opts) {
      const extra = opts?.withReference ? " AND (bengali_meaning != '' OR english_meaning != '')" : "";
      const approved = opts?.approvedOnly ? " AND status = 'approved'" : "";
      return (db.prepare(`SELECT COUNT(*) AS c FROM dictionary_entries WHERE workspace_id = ? AND archived = 0${extra}${approved}`).get(workspaceId) as unknown as { c: number }).c;
    },

    async lastEntryUpdated(workspaceId) {
      const row = db.prepare("SELECT MAX(updated_at) AS u FROM dictionary_entries WHERE workspace_id = ?").get(workspaceId) as unknown as { u: string | null };
      return row.u;
    },

    async linkEntriesToLanguage(workspaceId, languageId) {
      db.prepare("UPDATE dictionary_entries SET language_id = ? WHERE workspace_id = ? AND language_id IS NULL").run(languageId, workspaceId);
    },

    async setEntryLearning(id, status, updatedAt) {
      db.prepare("UPDATE dictionary_entries SET learning_status = ?, updated_at = ? WHERE id = ?").run(status, updatedAt, id);
    },

    /* ------------------------------ workspaces ------------------------------ */

    async getWorkspace(id) {
      return db.prepare("SELECT id, name, organization_id, is_demo, created_at FROM workspaces WHERE id = ?").get(id) as unknown as WorkspaceCoreRow | undefined;
    },

    async insertWorkspace(row) {
      db.prepare("INSERT INTO workspaces (id, name, normalized_name, owner_user_id, organization_id, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(row.id, row.name, row.normalized_name, row.owner_user_id, row.organization_id, row.is_demo, row.created_at, row.created_at);
    },

    async renameWorkspace(id, name, normalized_name, updatedAt) {
      db.prepare("UPDATE workspaces SET name = ?, normalized_name = ?, updated_at = ? WHERE id = ?").run(name, normalized_name, updatedAt, id);
    },

    async deleteWorkspace(id) {
      db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
    },

    async listWorkspaceSummaries(userId): Promise<WorkspaceSummaryRow[]> {
      return db
        .prepare(
          `SELECT w.id, w.name, w.organization_id, w.is_demo, m.role, w.created_at,
            (SELECT name FROM languages l WHERE l.workspace_id = w.id LIMIT 1) AS language_name,
            (SELECT COUNT(*) FROM dictionary_entries e WHERE e.workspace_id = w.id AND e.archived = 0) AS word_count
           FROM workspaces w
           JOIN workspace_memberships m ON m.workspace_id = w.id
           WHERE m.user_id = ?
           ORDER BY w.created_at ASC`
        )
        .all(userId) as unknown as WorkspaceSummaryRow[];
    },

    /* ------------------------------ memberships ----------------------------- */

    async getMembership(workspaceId, userId) {
      return db
        .prepare("SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?")
        .get(workspaceId, userId) as unknown as { role: string } | undefined;
    },

    async insertMembership(row) {
      db.prepare("INSERT INTO workspace_memberships (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(row.id, row.workspace_id, row.user_id, row.role, row.created_at);
    },

    async updateMembershipRole(workspaceId, userId, role) {
      db.prepare("UPDATE workspace_memberships SET role = ? WHERE workspace_id = ? AND user_id = ?").run(role, workspaceId, userId);
    },

    async deleteMembership(workspaceId, userId) {
      db.prepare("DELETE FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?").run(workspaceId, userId);
    },

    async listMemberships(workspaceId) {
      return db
        .prepare("SELECT id, workspace_id, user_id, role, created_at FROM workspace_memberships WHERE workspace_id = ? ORDER BY created_at ASC")
        .all(workspaceId) as unknown as MembershipRow[];
    },

    /* -------------------------------- language ------------------------------- */

    async getLanguageByWorkspace(workspaceId) {
      return db.prepare("SELECT * FROM languages WHERE workspace_id = ?").get(workspaceId) as unknown as LanguageRow | undefined;
    },

    async getLanguageById(id) {
      return db.prepare("SELECT * FROM languages WHERE id = ?").get(id) as unknown as LanguageRow | undefined;
    },

    async insertLanguage(row) {
      db.prepare(
        "INSERT INTO languages (id, workspace_id, name, normalized_name, description, status, version, profile_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(row.id, row.workspace_id, row.name, row.normalized_name, row.description, row.status, row.version, row.profile_json, row.created_at, row.updated_at);
    },

    async updateLanguage(id, patch) {
      const cols = Object.keys(patch);
      if (cols.length === 0) return;
      const sets = cols.map((c) => `${c} = ?`).join(", ");
      const values = cols.map((c) => (patch as Record<string, unknown>)[c]) as Array<string | number>;
      db.prepare(`UPDATE languages SET ${sets} WHERE id = ?`).run(...values, id);
    },

    async listLanguageNormalizedNames() {
      return (db.prepare("SELECT LOWER(normalized_name) AS n FROM languages").all() as unknown as Array<{ n: string }>).map((r) => r.n);
    },

    /* --------------------------- language versions --------------------------- */

    async listVersions(languageId) {
      return db
        .prepare("SELECT id, workspace_id, language_id, version, snapshot_json, change_summary, created_by, created_at FROM language_versions WHERE language_id = ? ORDER BY version DESC")
        .all(languageId) as unknown as VersionRow[];
    },

    async getVersion(languageId, version) {
      return db
        .prepare("SELECT id, workspace_id, language_id, version, snapshot_json, change_summary, created_by, created_at FROM language_versions WHERE language_id = ? AND version = ?")
        .get(languageId, version) as unknown as VersionRow | undefined;
    },

    async insertVersion(row) {
      db.prepare(
        "INSERT INTO language_versions (id, workspace_id, language_id, version, snapshot_json, change_summary, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(row.id, row.workspace_id, row.language_id, row.version, row.snapshot_json, row.change_summary, row.created_by, row.created_at);
    },

    /* --------------------------- generation jobs ----------------------------- */

    async getJob(id) {
      return db.prepare("SELECT * FROM generation_jobs WHERE id = ?").get(id) as unknown as JobRow | undefined;
    },

    async getActiveJob(workspaceId) {
      return db
        .prepare("SELECT id FROM generation_jobs WHERE workspace_id = ? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1")
        .get(workspaceId) as unknown as { id: string } | undefined;
    },

    async countJobs(workspaceId) {
      return (db.prepare("SELECT COUNT(*) AS c FROM generation_jobs WHERE workspace_id = ?").get(workspaceId) as unknown as { c: number }).c;
    },

    async insertJob(row) {
      db.prepare(
        "INSERT INTO generation_jobs (id, workspace_id, user_id, status, stages_json, result_json, error, style, reference_langs, preferred_name, created_at, updated_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(row.id, row.workspace_id, row.user_id, row.status, row.stages_json, row.result_json, row.error, row.style, row.reference_langs, row.preferred_name, row.created_at, row.updated_at, row.finished_at);
    },

    async updateJob(id, patch) {
      const cols = Object.keys(patch);
      if (cols.length === 0) return;
      const sets = cols.map((c) => `${c} = ?`).join(", ");
      const values = cols.map((c) => (patch as Record<string, unknown>)[c]) as Array<string | number>;
      db.prepare(`UPDATE generation_jobs SET ${sets} WHERE id = ?`).run(...values, id);
    },

    /* -------------------------------- activity ------------------------------- */

    async insertActivity(row) {
      db.prepare(
        "INSERT INTO activity_log (id, workspace_id, actor_user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(row.id, row.workspace_id, row.actor_user_id, row.action, row.resource_type, row.resource_id, row.metadata_json, row.created_at);
    },

    async listActivity(workspaceId, limit, offset): Promise<ActivityListResult> {
      const total = (db.prepare("SELECT COUNT(*) AS c FROM activity_log WHERE workspace_id = ?").get(workspaceId) as unknown as { c: number }).c;
      const rows = db
        .prepare("SELECT id, workspace_id, actor_user_id, action, resource_type, resource_id, metadata_json, created_at FROM activity_log WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?")
        .all(workspaceId, limit, offset) as unknown as ActivityRow[];
      return { rows, total };
    },

    async countActivity(workspaceId, action) {
      const sql = action
        ? "SELECT COUNT(*) AS c FROM activity_log WHERE workspace_id = ? AND action = ?"
        : "SELECT COUNT(*) AS c FROM activity_log WHERE workspace_id = ?";
      return (db.prepare(sql).get(...(action ? [workspaceId, action] : [workspaceId])) as unknown as { c: number }).c;
    },

    /* -------------------------------- phrasebook ----------------------------- */

    async listPhrasebook(workspaceId, limit) {
      return db
        .prepare("SELECT id, workspace_id, source_text, source_lang, translated_text, target_lang, note, created_at FROM phrasebook WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?")
        .all(workspaceId, limit) as unknown as PhraseRow[];
    },

    async insertPhrasebook(row) {
      db.prepare(
        "INSERT INTO phrasebook (id, workspace_id, source_text, source_lang, translated_text, target_lang, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(row.id, row.workspace_id, row.source_text, row.source_lang, row.translated_text, row.target_lang, row.note, row.created_at);
    },

    async deletePhrasebook(id, workspaceId) {
      db.prepare("DELETE FROM phrasebook WHERE id = ? AND workspace_id = ?").run(id, workspaceId);
    },

    /* ---------------------------- learning progress -------------------------- */

    async getProgress(userId, entryId) {
      return db
        .prepare("SELECT * FROM learning_progress WHERE user_id = ? AND dictionary_entry_id = ?")
        .get(userId, entryId) as unknown as ProgressRow | undefined;
    },

    async upsertProgress(row) {
      db.prepare(
        `UPDATE learning_progress
         SET status = ?, last_reviewed_at = ?, next_review_at = ?, correct_count = ?, incorrect_count = ?, interval_days = ?, updated_at = ?
         WHERE id = ?`
      ).run(row.status, row.last_reviewed_at, row.next_review_at, row.correct_count, row.incorrect_count, row.interval_days, row.updated_at, row.id);
      if ((db.prepare("SELECT changes() AS c").get() as unknown as { c: number }).c === 0) {
        db.prepare(
          `INSERT INTO learning_progress
           (id, workspace_id, user_id, language_id, dictionary_entry_id, status, last_reviewed_at, next_review_at, correct_count, incorrect_count, interval_days, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(row.id, row.workspace_id, row.user_id, row.language_id, row.dictionary_entry_id, row.status, row.last_reviewed_at, row.next_review_at, row.correct_count, row.incorrect_count, row.interval_days, row.updated_at);
      }
    },

    async listProgress(workspaceId, userId) {
      return db
        .prepare("SELECT * FROM learning_progress WHERE workspace_id = ? AND user_id = ?")
        .all(workspaceId, userId) as unknown as ProgressRow[];
    },

    /* -------------------------------- avatar ---------------------------------- */

    async getAvatarFileId(userId) {
      const row = db
        .prepare("SELECT avatar_file_id FROM user_profiles WHERE user_id = ?")
        .get(userId) as unknown as { avatar_file_id: string | null } | undefined;
      return row?.avatar_file_id || null;
    },

    async setAvatarFileId(userId, fileId) {
      db.prepare(
        "INSERT INTO user_profiles (user_id, avatar_file_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET avatar_file_id = excluded.avatar_file_id"
      ).run(userId, fileId);
    }
  } satisfies DataStore;
}
