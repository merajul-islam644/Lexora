import type { EntryRow, LanguageRow, JobRow } from "./rows.js";

/* The domain-data seam. Routes and services talk to this interface only --
   never to SQLite directly and never to Blocks directly. Two implementations
   exist: sqliteStore (local file, used by tests and offline dev) and
   blocksStore (SELISE Blocks Data Gateway, the real storage). Users, sessions
   and auth tokens are NOT part of this seam -- they stay in SQLite because
   Blocks IAM already owns real identity, and the local tables only mirror the
   signed-in user. */

export interface EntryListOpts {
  q?: string;
  pos?: string;
  learning?: string;
  source?: string;
  sort?: "alpha" | "newest" | "updated" | "needs_revision";
  limit: number;
  offset: number;
}

export interface EntryListResult {
  rows: EntryRow[];
  total: number;
}

export interface WorkspaceCoreRow {
  id: string;
  name: string;
  is_demo: number;
  created_at: string;
}

export interface WorkspaceSummaryRow {
  id: string;
  name: string;
  is_demo: number;
  role: string;
  created_at: string;
  language_name: string | null;
  word_count: number;
}

export interface MembershipRow {
  id: string;
  workspace_id: string;
  user_id: string;
  role: string;
  created_at: string;
}

export interface ActivityRow {
  id: string;
  workspace_id: string;
  actor_user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  metadata_json: string;
  created_at: string;
}

export interface PhraseRow {
  id: string;
  workspace_id: string;
  source_text: string;
  source_lang: string;
  translated_text: string;
  target_lang: string;
  note: string;
  created_at: string;
}

export interface ProgressRow {
  id: string;
  workspace_id: string;
  user_id: string;
  language_id: string | null;
  dictionary_entry_id: string;
  status: string;
  last_reviewed_at: string | null;
  next_review_at: string | null;
  correct_count: number;
  incorrect_count: number;
  interval_days: number;
  updated_at: string;
}

export interface VersionRow {
  id: string;
  workspace_id: string;
  language_id: string;
  version: number;
  snapshot_json: string;
  change_summary: string;
  created_by: string;
  created_at: string;
}

export interface ActivityListResult {
  rows: ActivityRow[];
  total: number;
}

export interface DataStore {
  /* ------------------------------ dictionary ------------------------------ */
  listEntries(workspaceId: string, opts: EntryListOpts): Promise<EntryListResult>;
  getEntryById(id: string, workspaceId: string, opts?: { includeArchived?: boolean }): Promise<EntryRow | undefined>;
  /** Full unpaginated set -- export, translation, word builder, generation all
   * operate on the whole (small) dictionary of one workspace. */
  findEntries(workspaceId: string, opts?: { includeArchived?: boolean }): Promise<EntryRow[]>;
  findEntryByNormalized(workspaceId: string, normalizedWord: string, opts?: { excludeId?: string; includeArchived?: boolean }): Promise<EntryRow | undefined>;
  recentEntries(workspaceId: string, limit: number): Promise<EntryRow[]>;
  insertEntry(row: EntryRow): Promise<void>;
  updateEntry(workspaceId: string, id: string, patch: Partial<EntryRow>): Promise<void>;
  countEntries(workspaceId: string, opts?: { withReference?: boolean; approvedOnly?: boolean }): Promise<number>;
  lastEntryUpdated(workspaceId: string): Promise<string | null>;
  /** Attach unlinked entries to the workspace's language (idempotent). */
  linkEntriesToLanguage(workspaceId: string, languageId: string): Promise<void>;
  setEntryLearning(id: string, status: string, updatedAt: string): Promise<void>;

  /* ------------------------------ workspaces ------------------------------ */
  getWorkspace(id: string): Promise<WorkspaceCoreRow | undefined>;
  insertWorkspace(row: WorkspaceCoreRow & { owner_user_id: string; normalized_name: string }): Promise<void>;
  renameWorkspace(id: string, name: string, normalized_name: string, updatedAt: string): Promise<void>;
  deleteWorkspace(id: string): Promise<void>;
  listWorkspaceSummaries(userId: string): Promise<WorkspaceSummaryRow[]>;

  /* ------------------------------ memberships ----------------------------- */
  getMembership(workspaceId: string, userId: string): Promise<{ role: string } | undefined>;
  insertMembership(row: MembershipRow): Promise<void>;
  updateMembershipRole(workspaceId: string, userId: string, role: string): Promise<void>;
  deleteMembership(workspaceId: string, userId: string): Promise<void>;
  listMemberships(workspaceId: string): Promise<MembershipRow[]>;

  /* -------------------------------- language ------------------------------- */
  getLanguageByWorkspace(workspaceId: string): Promise<LanguageRow | undefined>;
  getLanguageById(id: string): Promise<LanguageRow | undefined>;
  insertLanguage(row: LanguageRow): Promise<void>;
  updateLanguage(id: string, patch: Partial<LanguageRow>): Promise<void>;
  /** All language normalized names project-wide (uniqueness on generate). */
  listLanguageNormalizedNames(): Promise<string[]>;

  /* --------------------------- language versions --------------------------- */
  listVersions(languageId: string): Promise<VersionRow[]>;
  getVersion(languageId: string, version: number): Promise<VersionRow | undefined>;
  insertVersion(row: VersionRow): Promise<void>;

  /* --------------------------- generation jobs ----------------------------- */
  getJob(id: string): Promise<JobRow | undefined>;
  getActiveJob(workspaceId: string): Promise<{ id: string } | undefined>;
  countJobs(workspaceId: string): Promise<number>;
  insertJob(row: JobRow): Promise<void>;
  updateJob(id: string, patch: Partial<JobRow>): Promise<void>;

  /* -------------------------------- activity ------------------------------- */
  insertActivity(row: ActivityRow): Promise<void>;
  listActivity(workspaceId: string, limit: number, offset: number): Promise<ActivityListResult>;
  countActivity(workspaceId: string, action?: string): Promise<number>;

  /* -------------------------------- phrasebook ----------------------------- */
  listPhrasebook(workspaceId: string, limit: number): Promise<PhraseRow[]>;
  insertPhrasebook(row: PhraseRow): Promise<void>;
  deletePhrasebook(id: string, workspaceId: string): Promise<void>;

  /* ---------------------------- learning progress -------------------------- */
  getProgress(userId: string, entryId: string): Promise<ProgressRow | undefined>;
  upsertProgress(row: ProgressRow): Promise<void>;
  listProgress(workspaceId: string, userId: string): Promise<ProgressRow[]>;
}
