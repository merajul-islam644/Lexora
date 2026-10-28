import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "../src/core/db/connection.js";
import { sqliteStore } from "../src/core/db/sqliteStore.js";
import { uid, nowIso } from "../src/core/db/ids.js";
import type { DataStore } from "../src/core/db/store.js";

/* Unit-test seam only: a throwaway SQLite DataStore stands in for the Blocks
   Data Gateway. The SPA's api.ts drives the same interface browser-side; the
   old function-router tests went with the relay. */

export interface TestEnv {
  db: Db;
  store: DataStore;
  dir: string;
}

export function makeTestEnv(): TestEnv {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lexora-test-"));
  const db = openDatabase(path.join(dir, "test.db"));
  return { db, store: sqliteStore(db), dir };
}

/** A workspace with `ownerEmail` as its owner member. */
export async function createWorkspace(env: TestEnv, ownerEmail: string, name: string): Promise<string> {
  const id = uid();
  await env.store.insertWorkspace({
    id,
    name,
    normalized_name: name.trim().toLowerCase(),
    owner_user_id: ownerEmail,
    is_demo: 0,
    created_at: nowIso()
  });
  await env.store.insertMembership({
    id: uid(),
    workspace_id: id,
    user_id: ownerEmail,
    role: "owner",
    created_at: nowIso()
  });
  return id;
}

export async function addEntry(
  env: TestEnv,
  workspaceId: string,
  word: string,
  bengaliMeaning = "পরীক্ষা",
  englishMeaning = "test word"
): Promise<string> {
  const id = uid();
  const now = nowIso();
  await env.store.insertEntry({
    id,
    workspace_id: workspaceId,
    language_id: null,
    word,
    normalized_word: word.normalize("NFC").trim().toLowerCase(),
    bengali_meaning: bengaliMeaning,
    english_meaning: englishMeaning,
    pronunciation_guide: "",
    ipa: "",
    part_of_speech: "noun",
    root: "",
    word_formation_explanation: "",
    prefixes: "",
    suffixes: "",
    grammar_notes: "",
    example_sentences_json: "[]",
    related_word_ids_json: "[]",
    mnemonic: "",
    learning_status: "new",
    source: "user",
    status: "approved",
    archived: 0,
    entry_version: 1,
    history_json: "[]",
    created_at: now,
    updated_at: now
  });
  return id;
}
