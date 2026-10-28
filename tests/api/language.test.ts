import { describe, it, expect, beforeAll } from "vitest";
import { makeTestEnv, call, createWorkspace, addEntry, sleep, type TestEnv } from "../helpers.js";

let env: TestEnv;
let userA: string;
let wsA: string;
let userB: string;
let wsB: string;
let viewer: string;

const TERMINAL = ["completed", "failed", "cancelled", "timeout"];

async function generate(user: string, wsId: string, body: Record<string, unknown> = {}) {
  return call(env, user, "POST", `/api/ws/${wsId}/language/generate`, body);
}

async function awaitJob(user: string, wsId: string, jobId: string): Promise<{ status: string; result: Record<string, unknown> | null; stages: Array<{ id: string; status: string }> }> {
  for (let i = 0; i < 100; i++) {
    const res = await call(env, user, "GET", `/api/ws/${wsId}/language/jobs/${jobId}`);
    if (res.status === 200 && TERMINAL.includes(res.body.status)) return res.body;
    await sleep(50);
  }
  throw new Error("generation job did not reach a terminal state");
}

beforeAll(async () => {
  env = makeTestEnv();
  userA = "gen-a@test.dev";
  userB = "gen-b@test.dev";
  viewer = "gen-viewer@test.dev";
  wsA = await createWorkspace(env, userA, "Gen A Co");
  wsB = await createWorkspace(env, userB, "Gen B Co");
});

describe("generation jobs", () => {
  it("refuses to start from an empty dictionary", async () => {
    const res = await generate(userA, wsA);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("dictionary_empty");
  });

  it("generates a language, honoring the preferred name", async () => {
    await addEntry(env, userA, wsA, "vethra", "চুক্তি", "agreement");
    await addEntry(env, userA, wsA, "kairum", "অনুমোদন", "approval");
    await addEntry(env, userA, wsA, "solven", "গোপনীয়", "confidential");
    const start = await generate(userA, wsA, { preferredName: "testlang", style: "naturalistic" });
    expect(start.status).toBe(202);
    const job = await awaitJob(userA, wsA, start.body.jobId);
    expect(job.status).toBe("completed");
    expect(String(job.result!.name).toLowerCase()).toBe("testlang");
    expect((job.stages as Array<{ id: string; status: string }>).every((s) => s.status === "done")).toBe(true);
    expect(job.result!.wordCount).toBeGreaterThan(20); // 3 user words + core vocabulary
  });

  it("exposes the language, grammar and versions afterwards", async () => {
    const lang = await call(env, userA, "GET", `/api/ws/${wsA}/language`);
    expect(lang.status).toBe(200);
    expect(lang.body.language.name.toLowerCase()).toBe("testlang");
    expect(lang.body.language.version).toBe(1);
    expect(lang.body.language.rulesCount).toBeGreaterThanOrEqual(5);

    const grammar = await call(env, userA, "GET", `/api/ws/${wsA}/language/grammar`);
    expect(grammar.status).toBe(200);
    expect(grammar.body.rules.length).toBeGreaterThanOrEqual(5);
    expect(["SOV", "SVO"]).toContain(grammar.body.language.wordOrder);
    expect(grammar.body.phonology.consonants.length).toBeGreaterThanOrEqual(6);

    const versions = await call(env, userA, "GET", `/api/ws/${wsA}/language/versions`);
    expect(versions.body.versions).toHaveLength(1);
  });

  it("inserts generated core words as draft entries, distinct from user words", async () => {
    const drafts = await call(env, userA, "GET", `/api/ws/${wsA}/dictionary?source=generated&pageSize=100`);
    expect(drafts.body.items.length).toBeGreaterThanOrEqual(20);
    expect(drafts.body.items.every((i: { status: string }) => i.status === "draft")).toBe(true);
    const users = await call(env, userA, "GET", `/api/ws/${wsA}/dictionary?source=user`);
    expect(users.body.items.every((i: { word: string }) => ["vethra", "kairum", "solven"].includes(i.word))).toBe(true);
  });

  it("regenerates as a new version and keeps the name", async () => {
    const start = await generate(userA, wsA, { style: "concise" });
    const job = await awaitJob(userA, wsA, start.body.jobId);
    expect(job.status).toBe("completed");
    expect(job.result!.version).toBe(2);

    const versions = await call(env, userA, "GET", `/api/ws/${wsA}/language/versions`);
    expect(versions.body.versions).toHaveLength(2);
    expect(versions.body.versions[0].version).toBe(2);
  });

  it("restores an old version as a new version (admin only)", async () => {
    const restore = await call(env, userA, "POST", `/api/ws/${wsA}/language/versions/1/restore`);
    expect(restore.status).toBe(200);
    expect(restore.body.version).toBe(3);
    const lang = await call(env, userA, "GET", `/api/ws/${wsA}/language`);
    expect(lang.body.language.version).toBe(3);
    expect((await call(env, userA, "GET", `/api/ws/${wsA}/language/versions`)).body.versions).toHaveLength(3);
    const missing = await call(env, userA, "POST", `/api/ws/${wsA}/language/versions/99/restore`);
    expect(missing.status).toBe(404);
  });

  it("renames the language but enforces global name uniqueness", async () => {
    await addEntry(env, userB, wsB, "ghora", "ঘোড়া", "horse");
    const startB = await generate(userB, wsB, { preferredName: "Rivera" });
    const jobB = await awaitJob(userB, wsB, startB.body.jobId);
    expect(jobB.status).toBe("completed");

    // B's workspace language name is taken — A renaming to it must fail.
    const clash = await call(env, userA, "PATCH", `/api/ws/${wsA}/language`, { name: "Rivera" });
    expect(clash.status).toBe(409);
    const ok = await call(env, userA, "PATCH", `/api/ws/${wsA}/language`, { name: "Testlang Prime" });
    expect(ok.status).toBe(200);
    const lang = await call(env, userA, "GET", `/api/ws/${wsA}/language`);
    expect(lang.body.language.name).toBe("Testlang Prime");
  });

  it("gives two workspaces different languages even from similar seeds", async () => {
    const langA = await call(env, userA, "GET", `/api/ws/${wsA}/language`);
    const langB = await call(env, userB, "GET", `/api/ws/${wsB}/language`);
    expect(langA.body.language.name.toLowerCase()).not.toBe(langB.body.language.name.toLowerCase());
  });

  it("a viewer cannot generate or restore", async () => {
    await call(env, userA, "POST", `/api/ws/${wsA}/members`, { email: viewer, role: "viewer" });
    expect((await generate(viewer, wsA)).status).toBe(403);
    expect((await call(env, viewer, "POST", `/api/ws/${wsA}/language/versions/1/restore`)).status).toBe(403);
  });

  it("cancel on an already-finished job is a harmless no-op", async () => {
    await addEntry(env, userB, wsB, "mela", "মেলা", "fair");
    const start = await generate(userB, wsB);
    const cancel = await call(env, userB, "POST", `/api/ws/${wsB}/language/jobs/${start.body.jobId}/cancel`);
    expect(cancel.status).toBe(200);
    expect(TERMINAL).toContain(cancel.body.status);
  });
});

describe("activity trail", () => {
  it("records generation, regeneration and restore events", async () => {
    const activity = await call(env, userA, "GET", `/api/ws/${wsA}/activity?pageSize=50`);
    const actions = (activity.body.items as Array<{ action: string }>).map((i) => i.action);
    expect(actions).toContain("language.created");
    expect(actions).toContain("language.regenerated");
    expect(actions).toContain("language.restored");
    expect(actions).toContain("language.renamed");
  });
});

describe("security page", () => {
  it("reports real counts, not marketing", async () => {
    const res = await call(env, userA, "GET", `/api/ws/${wsA}/security`);
    expect(res.status).toBe(200);
    expect(res.body.generationRuns).toBeGreaterThanOrEqual(3);
    expect(res.body.exportEvents).toBe(0);
  });
});
