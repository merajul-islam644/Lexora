import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "../src/core/db/connection.js";
import { sqliteStore } from "../src/core/db/sqliteStore.js";
import type { DataStore } from "../src/core/db/store.js";
import { route } from "../src/function/handler.js";
import type { ApiDeps, ApiRequest } from "../src/function/support.js";
import { HttpError } from "../src/core/lib/http.js";

/* The backend is the lexora-api Blocks Function, so tests drive the exported
   route() directly: an in-memory SQLite store stands in for the Data Gateway,
   and identity is the explicit caller email (the function resolves it from
   IAM; that hop is platform-owned). Assertions stay on the same JSON shapes
   the SPA consumes. */

export interface TestEnv {
  db: Db;
  store: DataStore;
  deps: ApiDeps;
  dir: string;
}

export function makeTestEnv(): TestEnv {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lexora-test-"));
  const db = openDatabase(path.join(dir, "test.db"));
  const store = sqliteStore(db);
  // Jobs keep running in the background exactly like ctx.waitUntil does;
  // tests poll for the terminal state. The files API is stubbed because no
  // test drives the avatar routes.
  const deps: ApiDeps = {
    store,
    schedule: (p) => void p,
    files: {} as unknown as ApiDeps["files"]
  };
  return { db, store, deps, dir };
}

export interface TestResponse {
  status: number;
  body: any;
  text?: string;
}

/** One call through the function's router as `userEmail`. */
export async function call(env: TestEnv, userEmail: string, method: string, path: string, body?: unknown): Promise<TestResponse> {
  const [pathname, search = ""] = path.replace(/^\/api\/?/, "").split("?");
  const query: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(search)) query[k] = v;
  const req: ApiRequest = {
    method: method.toUpperCase(),
    segments: pathname.split("/").filter(Boolean),
    query,
    body,
    userEmail
  };
  try {
    const res = await route(env.deps, req);
    return toResponse(res);
  } catch (err) {
    if (err instanceof HttpError) {
      return toResponse({
        statusCode: err.status,
        body: { error: { code: err.code, message: err.message, details: err.details } }
      });
    }
    throw err;
  }
}

function toResponse(res: { statusCode: number; body?: unknown }): TestResponse {
  return { status: res.statusCode, body: res.body ?? {}, text: typeof res.body === "string" ? res.body : JSON.stringify(res.body ?? {}) };
}

export async function createWorkspace(env: TestEnv, userEmail: string, name: string): Promise<string> {
  const res = await call(env, userEmail, "POST", "/api/workspaces", { name });
  if (res.status !== 201) throw new Error("workspace creation failed: " + JSON.stringify(res.body));
  return res.body.workspace.id as string;
}

export async function addEntry(env: TestEnv, userEmail: string, wsId: string, word: string, bengaliMeaning = "পরীক্ষা", englishMeaning = "test word"): Promise<string> {
  const res = await call(env, userEmail, "POST", `/api/ws/${wsId}/dictionary`, { word, bengaliMeaning, englishMeaning });
  if (res.status !== 201) throw new Error("entry creation failed: " + JSON.stringify(res.body));
  return res.body.entry.id as string;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
