import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";

export type Db = DatabaseSync;

/**
 * Schema follows the data model in design.md §15. Written in portable SQL so a
 * move to PostgreSQL (the production baseline) is a contained change in this
 * file: TEXT ids, ISO-8601 timestamps, JSON stored as TEXT with helpers below.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    email_verified_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,               -- sha256 of the session token
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_agent TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS auth_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('verify_email','password_reset')),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id);

  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_user_id);

  CREATE TABLE IF NOT EXISTS workspace_memberships (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner','admin','editor','viewer')),
    created_at TEXT NOT NULL,
    UNIQUE (workspace_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_memberships_user ON workspace_memberships(user_id);

  CREATE TABLE IF NOT EXISTS languages (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
    version INTEGER NOT NULL DEFAULT 0,
    profile_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_languages_normalized_name ON languages(normalized_name);
  CREATE INDEX IF NOT EXISTS idx_languages_workspace ON languages(workspace_id);

  CREATE TABLE IF NOT EXISTS language_versions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    language_id TEXT NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    change_summary TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (language_id, version)
  );

  CREATE TABLE IF NOT EXISTS generation_jobs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued'
      CHECK (status IN ('queued','running','completed','failed','cancelled','timeout')),
    stages_json TEXT NOT NULL DEFAULT '[]',
    result_json TEXT,
    error TEXT,
    style TEXT NOT NULL,
    reference_langs TEXT NOT NULL,
    preferred_name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_workspace ON generation_jobs(workspace_id);

  CREATE TABLE IF NOT EXISTS dictionary_entries (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    language_id TEXT REFERENCES languages(id) ON DELETE SET NULL,
    word TEXT NOT NULL,
    normalized_word TEXT NOT NULL,
    bengali_meaning TEXT NOT NULL DEFAULT '',
    english_meaning TEXT NOT NULL DEFAULT '',
    pronunciation_guide TEXT NOT NULL DEFAULT '',
    ipa TEXT NOT NULL DEFAULT '',
    part_of_speech TEXT NOT NULL DEFAULT 'noun',
    root TEXT NOT NULL DEFAULT '',
    word_formation_explanation TEXT NOT NULL DEFAULT '',
    prefixes TEXT NOT NULL DEFAULT '',
    suffixes TEXT NOT NULL DEFAULT '',
    grammar_notes TEXT NOT NULL DEFAULT '',
    example_sentences_json TEXT NOT NULL DEFAULT '[]',
    related_word_ids_json TEXT NOT NULL DEFAULT '[]',
    mnemonic TEXT NOT NULL DEFAULT '',
    learning_status TEXT NOT NULL DEFAULT 'new'
      CHECK (learning_status IN ('new','learning','remembered','needs_revision')),
    source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','generated','imported')),
    status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('draft','approved')),
    archived INTEGER NOT NULL DEFAULT 0,
    entry_version INTEGER NOT NULL DEFAULT 1,
    history_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (workspace_id, normalized_word)
  );
  CREATE INDEX IF NOT EXISTS idx_entries_workspace ON dictionary_entries(workspace_id);

  CREATE TABLE IF NOT EXISTS phrasebook (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    source_text TEXT NOT NULL,
    source_lang TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    target_lang TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS learning_progress (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    language_id TEXT,
    dictionary_entry_id TEXT NOT NULL REFERENCES dictionary_entries(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'new'
      CHECK (status IN ('new','learning','remembered','needs_revision')),
    last_reviewed_at TEXT,
    next_review_at TEXT,
    correct_count INTEGER NOT NULL DEFAULT 0,
    incorrect_count INTEGER NOT NULL DEFAULT 0,
    interval_days REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, dictionary_entry_id)
  );
  CREATE INDEX IF NOT EXISTS idx_progress_user ON learning_progress(user_id);

  CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    actor_user_id TEXT,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL DEFAULT '',
    resource_id TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_activity_workspace ON activity_log(workspace_id, created_at);

  CREATE TABLE IF NOT EXISTS outbox (
    id TEXT PRIMARY KEY,
    to_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `
];

export function openDatabase(dbPath: string): Db {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  for (const migration of MIGRATIONS) db.exec(migration);
  return db;
}

export function uid(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function randomToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Normalize a constructed word for uniqueness checks (spec §9). NFC + lowercase. */
export function normalizeWord(word: string): string {
  return word.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
}
