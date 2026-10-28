/* Smoke-test the deployed lexora-api function with the M2M token. The
 * function resolves identity from a *user* token (email claim), so an M2M
 * call should get the handler's own 401 envelope -- which proves the run
 * executed, auth is enforced, and the error contract survived the trip.
 * Run from the repo root:  npx tsx scripts/smoke-function.mts
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) {
    const k = line.slice(0, i).trim();
    if (!(k in process.env)) process.env[k] = line.slice(i + 1).trim();
  }
}

const { getBlocksClient } = await import("../src/core/services/blocksClient.js");

const FN = process.env.VITE_LEXORA_API_FUNCTION_ID ?? "";
if (!FN) throw new Error("VITE_LEXORA_API_FUNCTION_ID is not set");

const client = getBlocksClient();
const result = await client.logic.functions.invoke(FN, { method: "GET", path: "me", waitSeconds: 25 });
if (result.kind !== "answered") throw new Error(`unexpected kind: ${JSON.stringify(result).slice(0, 200)}`);
console.log("GET me (M2M) ->", result.status, JSON.stringify(result.body));
