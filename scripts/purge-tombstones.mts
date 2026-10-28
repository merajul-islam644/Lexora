/* One-off cleanup: hard-delete soft-deleted "tombstone" records left in the
 * Blocks project by earlier probe/CRUD testing. A tombstone is a record whose
 * ONLY property is ItemId -- provably field-less, so nothing of value can be
 * lost. Safety: before deleting anything, one tombstone is re-fetched by id;
 * if the gateway returns hidden fields for it, the script aborts untouched.
 */
import fs from "node:fs";
import { createBlocksClient } from "@seliseblocks/client";

const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").split(/\r?\n/).filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const client = createBlocksClient({ apiUrl: env.VITE_BLOCKS_API_URL, xBlocksKey: env.VITE_BLOCKS_X_BLOCKS_KEY });
const auth = await client.auth.oidc.clientCredentials({ clientId: env.LEXORA_BLOCKS_CLIENT_ID, clientSecret: env.LEXORA_BLOCKS_CLIENT_SECRET });
const authed = createBlocksClient({ apiUrl: env.VITE_BLOCKS_API_URL, xBlocksKey: env.VITE_BLOCKS_X_BLOCKS_KEY, accessToken: auth.accessToken ?? auth.access_token });

const SCHEMAS = ["Workspace", "WorkspaceMembership", "Language", "LanguageVersion", "DictionaryEntry", "GenerationJob", "ActivityLog", "Phrasebook", "LearningProgress"];

async function listAll(schema: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let pageNo = 1;
  for (;;) {
    const res = (await authed.data.collection(schema).list({ pageNo, pageSize: 500 })) as { data?: Record<string, { items?: Record<string, unknown>[] }> };
    const items = (res.data ? Object.values(res.data)[0] : undefined)?.items ?? [];
    out.push(...items);
    if (items.length < 500) return out;
    pageNo++;
  }
}

// Safety pre-check: prove tombstones are truly empty via a direct read.
let checked = 0;
for (const schema of SCHEMAS) {
  const tombstones = (await listAll(schema)).filter((r) => Object.keys(r).length === 1 && "ItemId" in r);
  if (tombstones.length === 0 || checked > 0) continue;
  const probe = (await authed.data.collection(schema).get(String(tombstones[0]!.ItemId))) as Record<string, unknown>;
  const data = (probe as { data?: unknown }).data ?? probe;
  const keys = Object.keys((data as Record<string, unknown>) ?? {});
  console.log(`pre-check ${schema} tombstone ${String(tombstones[0]!.ItemId).slice(0, 8)} -> keys: [${keys.join(", ")}]`);
  if (keys.some((k) => k !== "ItemId")) {
    console.error("ABORT: tombstone has fields -- not deleting anything.");
    process.exit(1);
  }
  checked++;
}

let totalDeleted = 0;
for (const schema of SCHEMAS) {
  const tombstones = (await listAll(schema)).filter((r) => Object.keys(r).length === 1 && "ItemId" in r);
  for (const t of tombstones) {
    await authed.data.collection(schema).delete(String(t.ItemId), { hardDelete: true });
    totalDeleted++;
  }
  console.log(`${schema.padEnd(22)} purged=${tombstones.length}`);
}
console.log(`\nDone. ${totalDeleted} tombstones hard-deleted.`);
