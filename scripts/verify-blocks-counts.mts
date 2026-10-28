/* Verify migration: count ItemIds per schema in the Blocks Data Gateway. */
import fs from "node:fs";
import { createBlocksClient } from "@seliseblocks/client";

const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const client = createBlocksClient({ apiUrl: env.VITE_BLOCKS_API_URL, xBlocksKey: env.VITE_BLOCKS_X_BLOCKS_KEY });
const auth = await client.auth.oidc.clientCredentials({ clientId: env.LEXORA_BLOCKS_CLIENT_ID, clientSecret: env.LEXORA_BLOCKS_CLIENT_SECRET });
const authed = createBlocksClient({
  apiUrl: env.VITE_BLOCKS_API_URL, xBlocksKey: env.VITE_BLOCKS_X_BLOCKS_KEY,
  accessToken: auth.accessToken ?? auth.access_token
});

async function count(schema: string): Promise<number> {
  let pageNo = 1, total = 0;
  for (;;) {
    const res = (await authed.data.collection(schema).list({ pageNo, pageSize: 500 })) as {
      data?: Record<string, { items?: unknown[]; totalCount?: number }>;
    };
    const payload = res.data ? (Object.values(res.data)[0] ?? {}) : {};
    const items = payload.items ?? [];
    total += items.length;
    const grand = payload.totalCount;
    if (typeof grand === "number") return grand;
    if (items.length < 500) return total;
    pageNo++;
  }
}

let bad = 0;
for (const [schema, expected] of [
  ["Workspace", 2], ["WorkspaceMembership", 2], ["Language", 2], ["DictionaryEntry", 99],
  ["LanguageVersion", 3], ["GenerationJob", 3], ["ActivityLog", 7], ["Phrasebook", 1], ["LearningProgress", 2]
] as const) {
  const n = await count(schema);
  const ok = n === expected;
  if (!ok) bad++;
  console.log(`${schema.padEnd(22)} ${String(n).padStart(4)}  expected=${expected}  ${ok ? "OK" : "MISMATCH"}`);
}
process.exit(bad === 0 ? 0 : 1);
