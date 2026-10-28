/* One-off identity migration: Blocks rows still key users by the old local
 * SQLite UUIDs; the function keys them by lowercase email (IAM is the only
 * identity now). Rewrites every user-keyed field using data/lexora.db's
 * users table as the UUID -> email map:
 *
 *   Workspace.ownerUserId, WorkspaceMembership.userId,
 *   LearningProgress.userId, ActivityLog.actorUserId,
 *   GenerationJob.userId, LanguageVersion.authorUserId
 *
 * Idempotent: values that already contain "@" are skipped. Unknown UUIDs are
 * reported and left untouched. Re-run safely any number of times.
 *
 * Run from the repo root:  npx tsx scripts/migrate-identity-to-emails.mts
 */
import fs from "node:fs";

// Load .env before the server modules (same pattern as migrate-to-blocks).
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) {
    const k = line.slice(0, i).trim();
    if (!(k in process.env)) process.env[k] = line.slice(i + 1).trim();
  }
}

const { DatabaseSync } = await import("node:sqlite");
const { getBlocksClient } = await import("../src/core/services/blocksClient.js");

type Rec = Record<string, unknown>;

const db = new DatabaseSync("data/lexora.db", { readOnly: true });
const uuidToEmail = new Map(
  (db.prepare("select id, email from users").all() as Array<{ id: string; email: string }>)
    .map((u) => [u.id, u.email.trim().toLowerCase()])
);

const PAGE = 500;
const client = getBlocksClient();

async function listAll(schema: string, fields: string[]): Promise<Rec[]> {
  const col = client.data.collection<Rec>(schema);
  const out: Rec[] = [];
  let pageNo = 1;
  for (;;) {
    const res = await col.list({ fields, pageNo, pageSize: PAGE });
    const data = (res as { data?: Rec }).data;
    const payload = data ? data[Object.keys(data)[0]] : undefined;
    const items = ((payload as Rec)?.items ?? []) as Rec[];
    const total = Number((payload as Rec)?.totalCount ?? 0);
    out.push(...items);
    if (out.length >= total || items.length === 0) break;
    pageNo += 1;
  }
  return out;
}

/* Tombstones (empty soft-deleted records) have no field values -- skip them
   silently; a row counts only when the field exists and is non-empty. */
async function rekey(schema: string, field: string): Promise<void> {
  const rows = await listAll(schema, ["ItemId", field]);
  let changed = 0, alreadyEmail = 0, empty = 0, unknown = 0;
  for (const row of rows) {
    const value = row[field];
    if (value === null || value === undefined || value === "") { empty++; continue; }
    const current = String(value);
    if (current.includes("@")) { alreadyEmail++; continue; }
    const email = uuidToEmail.get(current);
    if (!email) { unknown++; console.warn(`  [${schema}] unknown user id ${current} on ${row.ItemId} -- left as-is`); continue; }
    await client.data.collection<Rec>(schema).update(row.ItemId as string, { [field]: email });
    changed++;
  }
  const pad = `${schema}.${field}`.padEnd(34);
  console.log(`${pad} updated=${changed} already-email=${alreadyEmail} empty=${empty} unknown=${unknown}`);
}

console.log("Rekeying Blocks user ids (UUID -> email) ...");
await rekey("Workspace", "ownerUserId");
await rekey("WorkspaceMembership", "userId");
await rekey("LearningProgress", "userId");
await rekey("ActivityLog", "actorUserId");
await rekey("GenerationJob", "userId");
await rekey("LanguageVersion", "authorUserId");
console.log("Done.");
