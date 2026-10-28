/* One-off migration: local SQLite -> SELISE Blocks Data Gateway.
 *
 * Reads every domain table from data/lexora.db and writes it through the
 * blocksStore insert methods, so the exact production mapping is used. ItemId
 * is set to the existing SQLite UUID, so ids (and cross-references between
 * entries, progress, activity, ...) stay valid with no remapping. Each record
 * is existence-checked first, so the script is safe to re-run.
 *
 * Users/sessions are intentionally NOT migrated: Blocks IAM owns identity.
 *
 * Run from the repo root:  npx tsx scripts/migrate-to-blocks.mts
 */
import fs from "node:fs";

// Load .env before the server modules: blocksClient reads process.env at call
// time, and env.ts defaults are fine, but the imports are dynamic anyway to
// guarantee ordering.
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) {
    const k = line.slice(0, i).trim();
    if (!(k in process.env)) process.env[k] = line.slice(i + 1).trim();
  }
}

const { openDatabase } = await import("../src/core/db/connection.js");
const { blocksStore } = await import("../src/core/db/blocksStore.js");

type Rec = Record<string, unknown>;

const db = openDatabase("data/lexora.db");
const blocks = blocksStore();

const all = (sql: string, ...params: (string | number)[]): Rec[] =>
  db.prepare(sql).all(...params) as unknown as Rec[];

const summary: Array<{ table: string; migrated: number; skipped: number; failed: number }> = [];

async function migrate(
  table: string,
  rows: Rec[],
  exists: (row: Rec) => Promise<boolean>,
  insert: (row: Rec) => Promise<void>
): Promise<void> {
  let migrated = 0, skipped = 0, failed = 0;
  for (const row of rows) {
    try {
      if (await exists(row)) { skipped++; continue; }
      await insert(row);
      migrated++;
    } catch (err) {
      failed++;
      console.error(`  [${table}] FAILED id=${row.id}:`, (err as Error).message.slice(0, 200));
    }
  }
  summary.push({ table, migrated, skipped, failed });
  console.log(`${table.padEnd(22)} migrated=${migrated} skipped(existing)=${skipped} failed=${failed}`);
}

console.log("Migrating SQLite -> Blocks Data Gateway ...");

/* 1. workspaces (parents first) */
await migrate(
  "workspaces",
  all("SELECT id, name, normalized_name, owner_user_id, is_demo, created_at FROM workspaces ORDER BY created_at"),
  async (r) => Boolean(await blocks.getWorkspace(r.id as string)),
  async (r) => {
    await blocks.insertWorkspace({
      id: r.id as string, name: r.name as string, normalized_name: r.normalized_name as string,
      owner_user_id: r.owner_user_id as string, is_demo: Number(r.is_demo) ? 1 : 0,
      created_at: r.created_at as string
    });
  }
);

/* 2. memberships */
await migrate(
  "workspace_memberships",
  all("SELECT id, workspace_id, user_id, role, created_at FROM workspace_memberships ORDER BY created_at"),
  async (r) => Boolean(await blocks.getMembership(r.workspace_id as string, r.user_id as string)),
  async (r) => {
    await blocks.insertMembership({
      id: r.id as string, workspace_id: r.workspace_id as string, user_id: r.user_id as string,
      role: r.role as string, created_at: r.created_at as string
    });
  }
);

/* 3. languages */
await migrate(
  "languages",
  all("SELECT id, workspace_id, name, normalized_name, description, status, version, profile_json, created_at, updated_at FROM languages ORDER BY created_at"),
  async (r) => Boolean(await blocks.getLanguageById(r.id as string)),
  async (r) => {
    await blocks.insertLanguage({
      id: r.id as string, workspace_id: r.workspace_id as string, name: r.name as string,
      normalized_name: r.normalized_name as string, description: (r.description as string) ?? "",
      status: r.status as string, version: Number(r.version ?? 1), profile_json: (r.profile_json as string) ?? "{}",
      created_at: r.created_at as string, updated_at: (r.updated_at as string) ?? (r.created_at as string)
    });
  }
);

/* 4. dictionary entries (biggest table) */
await migrate(
  "dictionary_entries",
  all("SELECT * FROM dictionary_entries ORDER BY created_at"),
  async (r) => Boolean(await blocks.getEntryById(r.id as string, r.workspace_id as string, { includeArchived: true })),
  async (r) => { await blocks.insertEntry(r as never); }
);

/* 5. language versions */
await migrate(
  "language_versions",
  all("SELECT id, workspace_id, language_id, version, snapshot_json, change_summary, created_by, created_at FROM language_versions ORDER BY created_at"),
  async (r) => Boolean(await blocks.getVersion(r.language_id as string, Number(r.version))),
  async (r) => {
    await blocks.insertVersion({
      id: r.id as string, workspace_id: r.workspace_id as string, language_id: r.language_id as string,
      version: Number(r.version), snapshot_json: r.snapshot_json as string,
      change_summary: (r.change_summary as string) ?? "", created_by: r.created_by as string,
      created_at: r.created_at as string
    });
  }
);

/* 6. generation jobs */
await migrate(
  "generation_jobs",
  all("SELECT * FROM generation_jobs ORDER BY created_at"),
  async (r) => Boolean(await blocks.getJob(r.id as string)),
  async (r) => { await blocks.insertJob(r as never); }
);

/* 7. activity log */
{
  const wsIds = all("SELECT id FROM workspaces").map((r) => r.id as string);
  const existing = new Set<string>();
  const rows: Rec[] = [];
  for (const wsId of wsIds) {
    rows.push(...all("SELECT id, workspace_id, actor_user_id, action, resource_type, resource_id, metadata_json, created_at FROM activity_log WHERE workspace_id = ?", wsId));
    let offset = 0;
    for (;;) {
      const page = await blocks.listActivity(wsId, 500, offset);
      for (const a of page.rows) existing.add(a.id);
      if (offset + page.rows.length >= page.total || page.rows.length === 0) break;
      offset += page.rows.length;
    }
  }
  await migrate(
    "activity_log",
    rows,
    async (r) => existing.has(r.id as string),
    async (r) => {
      await blocks.insertActivity({
        id: r.id as string, workspace_id: r.workspace_id as string, actor_user_id: (r.actor_user_id as string) ?? null,
        action: r.action as string, resource_type: r.resource_type as string, resource_id: r.resource_id as string,
        metadata_json: r.metadata_json as string, created_at: r.created_at as string
      });
    }
  );
}

/* 8. phrasebook */
{
  const wsIds = all("SELECT id FROM workspaces").map((r) => r.id as string);
  const existing = new Set<string>();
  const rows: Rec[] = [];
  for (const wsId of wsIds) {
    const local = all("SELECT id, workspace_id, source_text, source_lang, translated_text, target_lang, note, created_at FROM phrasebook WHERE workspace_id = ?", wsId);
    rows.push(...local);
    for (const p of await blocks.listPhrasebook(wsId, 10_000)) existing.add(p.id);
  }
  await migrate(
    "phrasebook",
    rows,
    async (r) => existing.has(r.id as string),
    async (r) => {
      await blocks.insertPhrasebook({
        id: r.id as string, workspace_id: r.workspace_id as string, source_text: r.source_text as string,
        source_lang: r.source_lang as string, translated_text: r.translated_text as string,
        target_lang: r.target_lang as string, note: (r.note as string) ?? "", created_at: r.created_at as string
      });
    }
  );
}

/* 9. learning progress */
await migrate(
  "learning_progress",
  all("SELECT * FROM learning_progress"),
  async (r) => Boolean(await blocks.getProgress(r.user_id as string, r.dictionary_entry_id as string)),
  async (r) => { await blocks.upsertProgress(r as never); }
);

console.log("\nSummary:");
let failed = 0;
for (const s of summary) {
  failed += s.failed;
  console.log(`  ${s.table.padEnd(22)} migrated=${s.migrated} skipped=${s.skipped} failed=${s.failed}`);
}
console.log(failed === 0 ? "\nMigration complete: no failures." : `\nMigration finished WITH ${failed} failures (re-run to retry).`);
process.exit(failed === 0 ? 0 : 1);
