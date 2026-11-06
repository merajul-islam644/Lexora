import { describe, it, expect, vi } from "vitest";
import {
  createApiRouter,
  ApiError,
  type ApiRouter,
  type ApiRouterDeps,
} from "../../src/web/api.js";
import {
  makeTestEnv,
  createWorkspace,
  addEntry,
  type TestEnv,
} from "../helpers.js";
import { uid, nowIso } from "../../src/core/db/ids.js";
import { runGenerationJob } from "../../src/core/services/generationRunner.js";
import type { WorkspaceRole } from "../../src/shared/schemas.js";
import type { JobRow } from "../../src/core/db/rows.js";

// The Blocks SDK builds its client at module load and refuses without a
// browser (it reads window.location for the OIDC redirect URI). None of
// these routes touch the real client -- the DataStore is injected -- so a
// minimal window stand-in satisfies the constructor under node. Hoisted so
// it runs before the import graph is evaluated.
vi.hoisted(() => {
  if (typeof globalThis.window === "undefined") {
    (globalThis as unknown as { window: { location: { origin: string } } }).window =
      { location: { origin: "https://lexora.test" } };
  }
});

/* Route-level authorization and tenant-isolation tests (design.md §14, §20):
   the exact handlers the browser ships, driven through createApiRouter
   against a throwaway SQLite DataStore with an injected identity -- no
   network, no Blocks client.

   The trust root these tests also document: requireWorkspace answers 404 for
   non-members (anti-probing) and 403 for under-privileged members, but it
   TRUSTS the local membership table. Until the Data Gateway itself refuses
   cross-workspace row writes (the rules.json lockdown), anyone who can write
   Gateway rows can forge themselves a membership. One test below pins that
   path as the documented residual risk, not as desired behavior. */

function routerFor(
  env: TestEnv,
  who: { email: string; name?: string },
): ApiRouter {
  return createApiRouter({
    store: env.store,
    // Avatar routes would crash if hit; none of these tests touch them.
    files: undefined as unknown as ApiRouterDeps["files"],
    identity: async () => ({ email: who.email, name: who.name ?? who.email }),
    // Fire-and-forget, like the browser wiring; a rejected promise here must
    // not fail the test run. Nothing below schedules anything anyway: every
    // job in this file is inserted directly to keep the runner out of the
    // picture (no microtask races).
    schedule: (p) => {
      p.catch(() => undefined);
    },
    organizations: async () => ({ organizations: [] }),
  });
}

/** Like routerFor, but the scheduled generation promises are collected so
 * tests can await real end-to-end generation deterministically. */
function scheduledRouterFor(env: TestEnv, email: string) {
  const scheduled: Promise<unknown>[] = [];
  const router = createApiRouter({
    store: env.store,
    files: undefined as unknown as ApiRouterDeps["files"],
    identity: async () => ({ email, name: email }),
    schedule: (p) => {
      scheduled.push(p);
    },
    organizations: async () => ({ organizations: [] }),
  });
  return {
    router,
    drain: async () => {
      await Promise.all(scheduled.splice(0));
    },
  };
}

async function addMemberRow(
  env: TestEnv,
  workspaceId: string,
  email: string,
  role: WorkspaceRole,
): Promise<void> {
  await env.store.insertMembership({
    id: uid(),
    workspace_id: workspaceId,
    user_id: email,
    role,
    created_at: nowIso(),
  });
}

async function insertJobRow(
  env: TestEnv,
  workspaceId: string,
  userId: string,
  status: JobRow["status"],
): Promise<string> {
  const id = uid();
  const now = nowIso();
  await env.store.insertJob({
    id,
    workspace_id: workspaceId,
    user_id: userId,
    status,
    stages_json: "[]",
    result_json: null,
    error: null,
    style: "naturalistic",
    reference_langs: "both",
    preferred_name: null,
    created_at: now,
    updated_at: now,
    finished_at: null,
  });
  return id;
}

/** Asserts the request fails with exactly this status and code, and hands
 * back the ApiError for further checks. */
async function expectApiError(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<ApiError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(status);
    expect(apiErr.code).toBe(code);
    return apiErr;
  }
  throw new Error(
    `expected the request to fail with ${status} ${code}, but it succeeded`,
  );
}

describe("api routes: tenant isolation (anti-probing)", () => {
  it("answers 404, never 403, on every route under a workspace the caller does not belong to", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Alpha");
    await addEntry(env, ws, "kaat");
    const owner = routerFor(env, { email: "owner@test.dev" });
    const intruder = routerFor(env, { email: "intruder@test.dev" });

    // Sanity: the owner gets through, so the 404s below mean "no membership",
    // not "route broken".
    await expect(owner.request("GET", `/api/ws/${ws}`)).resolves.toMatchObject({
      workspace: { id: ws },
    });

    await expectApiError(
      intruder.request("GET", `/api/ws/${ws}`),
      404,
      "not_found",
    );
    await expectApiError(
      intruder.request("DELETE", `/api/ws/${ws}`),
      404,
      "not_found",
    );
    await expectApiError(
      intruder.request("GET", `/api/ws/${ws}/dictionary`),
      404,
      "not_found",
    );
    await expectApiError(
      intruder.request("GET", `/api/ws/${ws}/members`),
      404,
      "not_found",
    );
    await expectApiError(
      intruder.request("POST", `/api/ws/${ws}/language/generate`, {}),
      404,
      "not_found",
    );
  });

  it("does not reveal whether a workspace id exists: unknown ids answer the same 404", async () => {
    const env = makeTestEnv();
    const owner = routerFor(env, { email: "owner@test.dev" });
    const ghost = uid();

    await expectApiError(
      owner.request("GET", `/api/ws/${ghost}`),
      404,
      "not_found",
    );
    await expectApiError(
      owner.request("GET", `/api/ws/${ghost}/members`),
      404,
      "not_found",
    );
    // Same answer shape as a real workspace the caller cannot see -- nothing
    // here distinguishes "exists, not yours" from "does not exist".
  });
});

describe("api routes: role ladder", () => {
  it("viewer: reads are allowed, every write is 403", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Ladder");
    await addMemberRow(env, ws, "viewer@test.dev", "viewer");
    const v = routerFor(env, { email: "viewer@test.dev" });

    await expect(v.request("GET", `/api/ws/${ws}`)).resolves.toMatchObject({
      workspace: { role: "viewer" },
    });
    await expectApiError(
      v.request("POST", `/api/ws/${ws}/dictionary`, { word: "peek" }),
      403,
      "forbidden",
    );
    await expectApiError(
      v.request("POST", `/api/ws/${ws}/members`, {
        email: "x@y.dev",
        role: "viewer",
      }),
      403,
      "forbidden",
    );
    await expectApiError(
      v.request("DELETE", `/api/ws/${ws}`),
      403,
      "forbidden",
    );
  });

  it("editor: writes dictionary entries, still 403 on membership and deletion", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Ladder");
    await addMemberRow(env, ws, "editor@test.dev", "editor");
    const e = routerFor(env, { email: "editor@test.dev" });

    await expect(
      e.request("POST", `/api/ws/${ws}/dictionary`, { word: "Editorword" }),
    ).resolves.toMatchObject({ entry: { word: "Editorword", source: "user" } });
    await expectApiError(
      e.request("POST", `/api/ws/${ws}/members`, {
        email: "x@y.dev",
        role: "viewer",
      }),
      403,
      "forbidden",
    );
    await expectApiError(
      e.request("DELETE", `/api/ws/${ws}`),
      403,
      "forbidden",
    );
  });

  it("admin: manages members, still 403 on workspace deletion", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Ladder");
    await addMemberRow(env, ws, "admin@test.dev", "admin");
    const a = routerFor(env, { email: "admin@test.dev" });

    await expect(
      a.request("POST", `/api/ws/${ws}/members`, {
        email: "newbie@test.dev",
        role: "viewer",
      }),
    ).resolves.toMatchObject({ message: "Member added." });
    await expectApiError(
      a.request("DELETE", `/api/ws/${ws}`),
      403,
      "forbidden",
    );
  });

  it("deletion is owner-only, and only the owner holds it", async () => {
    const env = makeTestEnv();
    const doomed = await createWorkspace(env, "owner@test.dev", "Doomed");
    const o = routerFor(env, { email: "owner@test.dev" });

    await expect(
      o.request("DELETE", `/api/ws/${doomed}`),
    ).resolves.toMatchObject({ message: "Workspace and all its data were deleted." });
    await expect(env.store.getWorkspace(doomed)).resolves.toBeUndefined();
  });
});

describe("api routes: escalation guards", () => {
  it("an admin cannot mint an owner, modify the owner, or remove the owner", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Esc");
    await addMemberRow(env, ws, "admin@test.dev", "admin");
    await addMemberRow(env, ws, "viewer@test.dev", "viewer");
    const a = routerFor(env, { email: "admin@test.dev" });
    const membersUrl = `/api/ws/${ws}/members`;

    await expectApiError(
      a.request("POST", membersUrl, { email: "new@test.dev", role: "owner" }),
      400,
      "bad_request",
    );
    await expectApiError(
      a.request("PATCH", `${membersUrl}/owner@test.dev`, { role: "viewer" }),
      400,
      "bad_request",
    );
    await expectApiError(
      a.request("PATCH", `${membersUrl}/viewer@test.dev`, { role: "owner" }),
      400,
      "bad_request",
    );
    await expectApiError(
      a.request("DELETE", `${membersUrl}/owner@test.dev`),
      400,
      "bad_request",
    );

    // None of the rejected calls changed anything.
    const { members } = (await a.request("GET", membersUrl)) as {
      members: Array<{ user_id: string; role: string }>;
    };
    expect(members.find((m) => m.user_id === "owner@test.dev")?.role).toBe(
      "owner",
    );
    expect(members.find((m) => m.user_id === "viewer@test.dev")?.role).toBe(
      "viewer",
    );
    expect(members.some((m) => m.user_id === "new@test.dev")).toBe(false);
  });

  it("an admin still does legitimate member management; unknown members 404", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Esc");
    await addMemberRow(env, ws, "admin@test.dev", "admin");
    await addMemberRow(env, ws, "viewer@test.dev", "viewer");
    const a = routerFor(env, { email: "admin@test.dev" });
    const membersUrl = `/api/ws/${ws}/members`;

    await expect(
      a.request("PATCH", `${membersUrl}/viewer@test.dev`, { role: "editor" }),
    ).resolves.toMatchObject({ message: "Role updated." });
    await expectApiError(
      a.request("PATCH", `${membersUrl}/ghost@test.dev`, { role: "viewer" }),
      404,
      "not_found",
    );
    await expectApiError(
      a.request("DELETE", `${membersUrl}/ghost@test.dev`),
      404,
      "not_found",
    );

    const { members } = (await a.request("GET", membersUrl)) as {
      members: Array<{ user_id: string; role: string }>;
    };
    expect(members.find((m) => m.user_id === "viewer@test.dev")?.role).toBe(
      "editor",
    );
  });
});

describe("api routes: membership trust root", () => {
  it("DOCUMENTED RESIDUAL RISK: a forged membership row is trusted until the Gateway refuses cross-workspace writes", async () => {
    // rules.json is empty today: any signed-in user can write Gateway rows
    // directly, so this path is reachable in production. The client-side
    // guard is the app's UX boundary, not its security boundary. This test
    // pins the behavior as a red/green marker for the gateway lockdown: once
    // Gateway policies reject foreign row writes, forged rows cannot exist
    // and the SPA's trust root shrinks to "memberships were written through
    // guarded app routes".
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Forged");
    const intruder = routerFor(env, { email: "intruder@test.dev" });

    await expectApiError(
      intruder.request("GET", `/api/ws/${ws}`),
      404,
      "not_found",
    );

    // The attack: one direct row insert the app never sees happen.
    await addMemberRow(env, ws, "intruder@test.dev", "owner");
    await expect(
      intruder.request("GET", `/api/ws/${ws}`),
    ).resolves.toMatchObject({ workspace: { role: "owner" } });
  });
});

describe("api routes: generation jobs", () => {
  it("a job is only visible and cancellable inside its own workspace", async () => {
    const env = makeTestEnv();
    const wsA = await createWorkspace(env, "a@test.dev", "A");
    const wsB = await createWorkspace(env, "b@test.dev", "B");
    const jobId = await insertJobRow(env, wsA, "a@test.dev", "running");
    // b owns B but belongs to no other workspace.
    const b = routerFor(env, { email: "b@test.dev" });

    // Not a member of A at all: the tenant guard fires first.
    await expectApiError(
      b.request("GET", `/api/ws/${wsA}/language/jobs/${jobId}`),
      404,
      "not_found",
    );
    // A member of B asking under B's own path: the job's workspace scoping
    // fires (b cannot launder A's job id through a workspace they belong to).
    await expectApiError(
      b.request("GET", `/api/ws/${wsB}/language/jobs/${jobId}`),
      404,
      "not_found",
    );
    await expectApiError(
      b.request("POST", `/api/ws/${wsB}/language/jobs/${jobId}/cancel`),
      404,
      "not_found",
    );
  });

  it("generate answers 409 job_active while a job is live, and leaves that job untouched", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Busy");
    await addEntry(env, ws, "kaat"); // non-empty, so the 409 is job_active
    const jobId = await insertJobRow(env, ws, "owner@test.dev", "running");
    const o = routerFor(env, { email: "owner@test.dev" });

    const err = await expectApiError(
      o.request("POST", `/api/ws/${ws}/language/generate`, {}),
      409,
      "job_active",
    );
    expect(err.message).toMatch(/already running/i);
    await expect(env.store.getJob(jobId)).resolves.toMatchObject({
      status: "running",
    });
  });

  it("generate on an empty dictionary answers 400 dictionary_empty", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Empty");
    const o = routerFor(env, { email: "owner@test.dev" });

    const err = await expectApiError(
      o.request("POST", `/api/ws/${ws}/language/generate`, {}),
      400,
      "bad_request",
    );
    expect(err.details).toBe("dictionary_empty");
  });

  it("cancelling a live job lands it on cancelled; a finished job keeps its status", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Jobs");
    const o = routerFor(env, { email: "owner@test.dev" });

    const liveJob = await insertJobRow(env, ws, "owner@test.dev", "queued");
    await expect(
      o.request("POST", `/api/ws/${ws}/language/jobs/${liveJob}/cancel`),
    ).resolves.toMatchObject({ id: liveJob, status: "cancelled" });
    await expect(
      o.request("GET", `/api/ws/${ws}/language/jobs/${liveJob}`),
    ).resolves.toMatchObject({ status: "cancelled" });

    const doneJob = await insertJobRow(env, ws, "owner@test.dev", "completed");
    await expect(
      o.request("POST", `/api/ws/${ws}/language/jobs/${doneJob}/cancel`),
    ).resolves.toMatchObject({ id: doneJob, status: "completed" });
    await expect(env.store.getJob(doneJob)).resolves.toMatchObject({
      status: "completed",
    });
  });
});

describe("api routes: audit trail", () => {
  it("member.added records actor, target and role", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Audit");
    await addMemberRow(env, ws, "admin@test.dev", "admin");
    const a = routerFor(env, { email: "admin@test.dev" });

    await a.request("POST", `/api/ws/${ws}/members`, {
      email: "newbie@test.dev",
      role: "viewer",
    });

    const rows = (await env.store.listActivity(ws, 100, 0)).rows;
    const row = rows.find((r) => r.action === "member.added");
    expect(row).toBeTruthy();
    expect(row?.actor_user_id).toBe("admin@test.dev");
    expect(row?.resource_id).toBe("newbie@test.dev");
    expect(JSON.parse(row?.metadata_json ?? "{}")).toMatchObject({
      role: "viewer",
    });
  });

  it("dictionary.exported records the format through the export route", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Audit");
    await addEntry(env, ws, "kaat");
    const o = routerFor(env, { email: "owner@test.dev" });

    const file = (await o.request(
      "GET",
      `/api/ws/${ws}/dictionary/export`,
    )) as { filename: string; contentType: string; content: string };
    expect(file.filename).toContain("csv");
    expect(file.content).toContain("kaat");

    const rows = (await env.store.listActivity(ws, 100, 0)).rows;
    const row = rows.find((r) => r.action === "dictionary.exported");
    expect(row).toBeTruthy();
    expect(JSON.parse(row?.metadata_json ?? "{}")).toMatchObject({
      format: "csv",
    });
  });
});

describe("api routes: starter dictionary (spec §16 empty-dictionary path)", () => {
  it("seeds business vocabulary in one POST, idempotently on the second", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Starter");
    const o = routerFor(env, { email: "owner@test.dev" });

    // First call: the full starter set lands.
    const first = (await o.request("POST", `/api/ws/${ws}/dictionary/starter`)) as {
      message: string;
      added: number;
      skipped: number;
    };
    expect(first.added).toBeGreaterThanOrEqual(40);
    expect(first.skipped).toBe(0);

    const listed = (await o.request("GET", `/api/ws/${ws}/dictionary`)) as {
      total: number;
    };
    expect(listed.total).toBe(first.added);

    // Second call: nothing new -- the route is idempotent.
    const second = (await o.request("POST", `/api/ws/${ws}/dictionary/starter`)) as {
      message: string;
      added: number;
      skipped: number;
    };
    expect(second.added).toBe(0);
    expect(second.skipped).toBe(first.added);
    expect(second.message).toMatch(/already/i);
    await expect(o.request("GET", `/api/ws/${ws}/dictionary`)).resolves.toMatchObject({
      total: first.added,
    });

    const rows = (await env.store.listActivity(ws, 100, 0)).rows;
    const row = rows.find((r) => r.action === "dictionary.starter_added");
    expect(row).toBeTruthy();
    expect(JSON.parse(row?.metadata_json ?? "{}")).toMatchObject({
      added: first.added,
      skipped: 0,
    });
  });

  it("is editor-gated: a viewer gets 403", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Starter");
    await addMemberRow(env, ws, "viewer@test.dev", "viewer");
    const v = routerFor(env, { email: "viewer@test.dev" });

    await expectApiError(
      v.request("POST", `/api/ws/${ws}/dictionary/starter`),
      403,
      "forbidden",
    );
    const listed = (await v.request("GET", `/api/ws/${ws}/dictionary`)) as {
      total: number;
    };
    expect(listed.total).toBe(0);
  });
});

describe("api routes: version compare (spec §16.10)", () => {
  it("diffs two recorded generations: words moved, name and rules compared", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Compare");
    await addEntry(env, ws, "kaat");
    await addEntry(env, ws, "venu");
    const { router, drain } = scheduledRouterFor(env, "owner@test.dev");

    // Two generations, awaited. Different job ids seed different profiles.
    const gen1 = (await router.request("POST", `/api/ws/${ws}/language/generate`, {})) as { jobId?: string };
    await drain();
    // Backdate job 1 past the 30s generate cooldown so job 2 can run now.
    await env.store.updateJob(gen1.jobId ?? "", {
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    const after1 = (await router.request("GET", `/api/ws/${ws}/language`)) as {
      language: { version: number };
    };
    expect(after1.language.version).toBe(1);

    await router.request("POST", `/api/ws/${ws}/language/generate`, {});
    await drain();
    const after2 = (await router.request("GET", `/api/ws/${ws}/language`)) as {
      language: { version: number };
    };
    expect(after2.language.version).toBe(2);

    const cmp = (await router.request(
      "GET",
      `/api/ws/${ws}/language/versions/compare?a=1&b=2`,
    )) as {
      from: { version: number; name: string; createdAt: string };
      to: { version: number; name: string; createdAt: string };
      diff: {
        summary: string;
        nameChanged: boolean;
        vocabAdded: unknown[];
        vocabRemoved: unknown[];
        rulesAdded: unknown[];
        rulesRemoved: unknown[];
        rulesChanged: unknown[];
        newWarnings: unknown[];
        resolvedWarnings: unknown[];
      };
    };
    expect(cmp.from).toMatchObject({ version: 1 });
    expect(cmp.to).toMatchObject({ version: 2 });
    expect(typeof cmp.from.createdAt).toBe("string");
    expect(typeof cmp.diff.summary).toBe("string");
    // Different seeds produce different generated vocab on at least one side.
    expect(cmp.diff.vocabAdded.length + cmp.diff.vocabRemoved.length).toBeGreaterThan(0);
    expect(Array.isArray(cmp.diff.rulesAdded)).toBe(true);
    expect(Array.isArray(cmp.diff.rulesChanged)).toBe(true);
    expect(Array.isArray(cmp.diff.newWarnings)).toBe(true);
    expect(Array.isArray(cmp.diff.resolvedWarnings)).toBe(true);
  });

  it("answers 400 for identical versions and 404 for unknown ones", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Compare");
    await addEntry(env, ws, "kaat");
    const { router, drain } = scheduledRouterFor(env, "owner@test.dev");
    await router.request("POST", `/api/ws/${ws}/language/generate`, {});
    await drain();

    await expectApiError(
      router.request("GET", `/api/ws/${ws}/language/versions/compare?a=1&b=1`),
      400,
      "bad_request",
    );
    await expectApiError(
      router.request("GET", `/api/ws/${ws}/language/versions/compare?a=1&b=99`),
      404,
      "not_found",
    );
  });
});

describe("api routes: job state surface (reload resume, spec §16.2)", () => {
  it("exposes style, referenceLangs and timestamps so the UI can rebuild progress after a reload", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Resume");
    const jobId = await insertJobRow(env, ws, "owner@test.dev", "running");
    const o = routerFor(env, { email: "owner@test.dev" });

    await expect(
      o.request("GET", `/api/ws/${ws}/language/jobs/${jobId}`),
    ).resolves.toMatchObject({
      id: jobId,
      status: "running",
      style: "naturalistic",
      referenceLangs: "both",
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      stages: [],
      result: null,
      error: null,
    });
  });
});

describe("api routes: dictionary status filter (draft review queue)", () => {
  it("serves draft-only and approved-only listings", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Filter");
    const o = routerFor(env, { email: "owner@test.dev" });

    await o.request("POST", `/api/ws/${ws}/dictionary`, {
      word: "Draftword",
      status: "draft",
    });
    await o.request("POST", `/api/ws/${ws}/dictionary`, { word: "Settleword" });

    const drafts = (await o.request(
      "GET",
      `/api/ws/${ws}/dictionary?status=draft`,
    )) as { total: number; items: Array<{ word: string; status: string }> };
    expect(drafts.total).toBe(1);
    expect(drafts.items[0]).toMatchObject({ word: "Draftword", status: "draft" });

    const approved = (await o.request(
      "GET",
      `/api/ws/${ws}/dictionary?status=approved`,
    )) as { total: number; items: Array<{ word: string }> };
    expect(approved.total).toBe(1);
    expect(approved.items[0]?.word).toBe("Settleword");

    const all = (await o.request("GET", `/api/ws/${ws}/dictionary`)) as {
      total: number;
    };
    expect(all.total).toBe(2);
  });
});

describe("generation runner: terminal race guard", () => {
  it("never resurrects a cancelled job into a completed language", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Race");
    await addEntry(env, ws, "kaat");
    const jobId = await insertJobRow(env, ws, "owner@test.dev", "cancelled");

    // The user cancelled; the runner finishing late must not win.
    await runGenerationJob(env.store, jobId);

    await expect(env.store.getJob(jobId)).resolves.toMatchObject({
      status: "cancelled",
    });
    await expect(
      env.store.getLanguageByWorkspace(ws),
    ).resolves.toBeUndefined();
  });
});

describe("api routes: grammar rule CRUD (Grammar Workspace, spec §11)", () => {
  it("adds, edits and removes a rule as versioned snapshots with audit entries", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Grammar");
    await addEntry(env, ws, "kaat");
    const { router, drain } = scheduledRouterFor(env, "owner@test.dev");
    await router.request("POST", `/api/ws/${ws}/language/generate`, {});
    await drain();

    const added = (await router.request("POST", `/api/ws/${ws}/language/rules`, {
      name: "Politeness doubling",
      category: "pragmatics",
      explanationEnglish: "Formal requests double the verb ending.",
      explanationBengali: "সম্মানসূচক অনুরোধে ক্রিয়ার সমাপ্তি দ্বিগুণ হয়।",
      pattern: "VERB + -a-a",
      validExamples: ["kairuma"],
    })) as { message: string; rule: { id: string; introducedInVersion: number }; version: number };
    expect(added.rule.introducedInVersion).toBe(2);
    expect(added.version).toBe(2);

    const updated = (await router.request(
      "PATCH",
      `/api/ws/${ws}/language/rules/${added.rule.id}`,
      { explanationEnglish: "Formal requests double the verb ending for extra deference." },
    )) as { rule: { name: string; introducedInVersion: number }; version: number };
    expect(updated.rule.name).toBe("Politeness doubling");
    expect(updated.rule.introducedInVersion).toBe(2); // preserved through edits
    expect(updated.version).toBe(3);

    const removed = (await router.request(
      "DELETE",
      `/api/ws/${ws}/language/rules/${added.rule.id}`,
    )) as { version: number };
    expect(removed.version).toBe(4);

    const rows = (await env.store.listActivity(ws, 100, 0)).rows;
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(["grammar.rule_added", "grammar.rule_updated", "grammar.rule_removed"]),
    );

    const grammar = (await router.request("GET", `/api/ws/${ws}/language/grammar`)) as {
      rules: Array<{ id: string }>;
      language: { version: number };
      vocabulary: unknown[];
    };
    expect(grammar.rules.some((r) => r.id === added.rule.id)).toBe(false);
    expect(grammar.language.version).toBe(4);
    expect(grammar.vocabulary.length).toBeGreaterThan(0);
  });

  it("gates writes (viewer 403, editor cannot delete) and holds the five-rule floor", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Grammar");
    await addMemberRow(env, ws, "editor@test.dev", "editor");
    await addMemberRow(env, ws, "viewer@test.dev", "viewer");
    await addEntry(env, ws, "kaat");
    const { router, drain } = scheduledRouterFor(env, "owner@test.dev");
    await router.request("POST", `/api/ws/${ws}/language/generate`, {});
    await drain();

    const viewer = scheduledRouterFor(env, "viewer@test.dev").router;
    await expectApiError(
      viewer.request("POST", `/api/ws/${ws}/language/rules`, {
        name: "Viewer rule",
        category: "syntax",
        explanationEnglish: "Viewer attempts are rejected.",
      }),
      403,
      "forbidden",
    );

    const editor = scheduledRouterFor(env, "editor@test.dev").router;
    const added = (await editor.request("POST", `/api/ws/${ws}/language/rules`, {
      name: "Temp rule",
      category: "syntax",
      explanationEnglish: "Editors can add rules.",
    })) as { rule: { id: string } };
    await expectApiError(
      editor.request("DELETE", `/api/ws/${ws}/language/rules/${added.rule.id}`),
      403,
      "forbidden",
    );

    await expectApiError(
      router.request("PATCH", `/api/ws/${ws}/language/rules/ghost-rule`, { name: "nope" }),
      404,
      "not_found",
    );

    // Trim down to the structural floor, then removal must refuse.
    let grammar = (await router.request("GET", `/api/ws/${ws}/language/grammar`)) as {
      rules: Array<{ id: string }>;
    };
    while (grammar.rules.length > 5) {
      await router.request("DELETE", `/api/ws/${ws}/language/rules/${grammar.rules[0]!.id}`);
      grammar = (await router.request("GET", `/api/ws/${ws}/language/grammar`)) as {
        rules: Array<{ id: string }>;
      };
    }
    expect(grammar.rules.length).toBe(5);
    await expectApiError(
      router.request("DELETE", `/api/ws/${ws}/language/rules/${grammar.rules[0]!.id}`),
      400,
      "bad_request",
    );
  });
});

describe("api routes: phrasebook notes + translation flag (spec §12, §15)", () => {
  it("saves a phrase with a note, edits the note, and flags drafts without recording text", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Phrase");
    const o = routerFor(env, { email: "owner@test.dev" });

    const saved = (await o.request("POST", `/api/ws/${ws}/phrasebook`, {
      sourceText: "We will review the contract",
      sourceLang: "english",
      translatedText: "Niv trenudo revoni sevani.",
      targetLang: "language",
      note: "use in kickoff calls",
    })) as { id: string };

    await o.request("PATCH", `/api/ws/${ws}/phrasebook/${saved.id}`, {
      note: "use in kickoff calls, never in emails",
    });
    const list = (await o.request("GET", `/api/ws/${ws}/phrasebook`)) as {
      items: Array<{ id: string; note: string }>;
    };
    expect(list.items[0]).toMatchObject({
      id: saved.id,
      note: "use in kickoff calls, never in emails",
    });

    await o.request("POST", `/api/ws/${ws}/translate/flag`, {
      from: "english",
      to: "language",
      reason: "word order felt wrong",
    });
    const rows = (await env.store.listActivity(ws, 100, 0)).rows;
    const flag = rows.find((r) => r.action === "translation.flagged");
    expect(flag).toBeTruthy();
    const meta = JSON.parse(flag?.metadata_json ?? "{}");
    expect(meta).toMatchObject({ from: "english", to: "language", reason: "word order felt wrong" });
    // Privacy rule: neither the source nor the translated text is in the audit.
    expect(JSON.stringify(meta)).not.toContain("contract");
    expect(JSON.stringify(meta)).not.toContain("Niv trenudo");
  });

  it("viewer can flag a draft but cannot save or edit phrases", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Phrase");
    await addMemberRow(env, ws, "viewer@test.dev", "viewer");
    const v = routerFor(env, { email: "viewer@test.dev" });

    await expect(
      v.request("POST", `/api/ws/${ws}/translate/flag`, { from: "english", to: "language", reason: "" }),
    ).resolves.toMatchObject({ message: expect.any(String) });
    await expectApiError(
      v.request("POST", `/api/ws/${ws}/phrasebook`, {
        sourceText: "x",
        sourceLang: "english",
        translatedText: "y",
        targetLang: "language",
        note: "",
      }),
      403,
      "forbidden",
    );
    await expectApiError(
      v.request("PATCH", `/api/ws/${ws}/phrasebook/whatever`, { note: "no" }),
      403,
      "forbidden",
    );
  });
});

describe("api routes: audit completion (spec §15)", () => {
  it("records role change, member removal, cancellation and phrase removal", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Audit");
    await addEntry(env, ws, "kaat");
    await addMemberRow(env, ws, "editor@test.dev", "editor");
    const o = routerFor(env, { email: "owner@test.dev" });

    await o.request("PATCH", `/api/ws/${ws}/members/editor@test.dev`, { role: "viewer" });
    await o.request("DELETE", `/api/ws/${ws}/members/editor@test.dev`);
    const gen = (await o.request("POST", `/api/ws/${ws}/language/generate`, {})) as { jobId?: string };
    expect(gen.jobId).toBeTruthy();
    await o.request("POST", `/api/ws/${ws}/language/jobs/${gen.jobId}/cancel`);
    const phrase = (await o.request("POST", `/api/ws/${ws}/phrasebook`, {
      sourceText: "hello",
      sourceLang: "english",
      translatedText: "salvoni",
      targetLang: "language",
      note: "",
    })) as { id: string };
    await o.request("DELETE", `/api/ws/${ws}/phrasebook/${phrase.id}`);

    const activity = (await o.request("GET", `/api/ws/${ws}/activity?limit=100`)) as {
      items: Array<{ action: string; resourceId: string; metadata: Record<string, unknown> }>;
    };
    const byAction = (action: string) => activity.items.find((a) => a.action === action);
    expect(byAction("member.role_changed")?.metadata).toMatchObject({
      from: "editor",
      to: "viewer",
    });
    expect(byAction("member.removed")?.metadata).toMatchObject({ role: "viewer" });
    expect(byAction("generation.cancelled")).toMatchObject({ resourceId: gen.jobId });
    expect(byAction("phrasebook.removed")).toMatchObject({ resourceId: phrase.id });
  });

  it("keeps audit tombstones after the workspace itself is deleted", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Tombstone");
    await addEntry(env, ws, "kaat");
    const { router, drain } = scheduledRouterFor(env, "owner@test.dev");
    await router.request("POST", `/api/ws/${ws}/language/generate`, {});
    await drain();

    await router.request("DELETE", `/api/ws/${ws}`);

    // The workspace and its content are gone...
    expect(await env.store.getWorkspace(ws)).toBeUndefined();
    // ...but the record of what happened there survives as detached tombstones.
    const detached = await env.store.listDetachedActivity();
    const actions = detached.map((a) => a.action);
    expect(actions).toContain("workspace.deleted");
    expect(actions).toContain("language.created");
    const deleted = detached.find((a) => a.action === "workspace.deleted");
    expect(JSON.parse(deleted?.metadata_json ?? "{}")).toMatchObject({ name: "Tombstone" });
  });
});

describe("api routes: avatar audit events (spec §15)", () => {
  it("records profile.avatar_updated in every workspace the user belongs to", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Avatar");
    const files = {
      delete: async () => undefined,
      get: async () => undefined,
      presignedUploadUrl: async () => undefined,
    };
    const o = createApiRouter({
      store: env.store,
      files: files as unknown as ApiRouterDeps["files"],
      identity: async () => ({ email: "owner@test.dev", name: "owner" }),
      schedule: (p) => {
        p.catch(() => undefined);
      },
      organizations: async () => ({ organizations: [] }),
    });

    await o.request("PATCH", "/api/me/avatar", { fileId: "file-123" });

    const activity = await env.store.listActivity(ws, 100, 0);
    expect(activity.rows.map((r) => r.action)).toContain("profile.avatar_updated");
    expect(activity.rows.find((r) => r.action === "profile.avatar_updated")?.actor_user_id).toBe(
      "owner@test.dev",
    );
  });
});

describe("api routes: full-workspace export (spec §14)", () => {
  it("exports every collection in one envelope and audits it", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Export");
    await addEntry(env, ws, "kaat");
    const { router, drain } = scheduledRouterFor(env, "owner@test.dev");
    await router.request("POST", `/api/ws/${ws}/language/generate`, {});
    await drain();

    const file = (await router.request("GET", `/api/ws/${ws}/export/all`)) as {
      filename: string;
      contentType: string;
      content: string;
    };
    expect(file.contentType).toBe("application/json");
    expect(file.filename).toMatch(/^lexora-export-.*\.json$/);
    const envelope = JSON.parse(file.content) as {
      format: string;
      workspace: { id: string };
      language: { version: number; profile: { name: string } };
      entries: unknown[];
      jobs: unknown[];
      versions: unknown[];
      activity: Array<{ action: string }>;
      counts: { entries: number };
    };
    expect(envelope.format).toBe("lexora-workspace-export/v1");
    expect(envelope.workspace.id).toBe(ws);
    expect(envelope.language?.version).toBe(1);
    expect(envelope.entries.length).toBeGreaterThan(0);
    expect(envelope.jobs.length).toBe(1);
    expect(envelope.versions.length).toBe(1);
    expect(envelope.activity.map((a) => a.action)).toContain("language.created");
    expect(envelope.counts.entries).toBe(envelope.entries.length);

    const activity = await env.store.listActivity(ws, 100, 0);
    expect(activity.rows.map((r) => r.action)).toContain("workspace.exported");

    // Editor is not enough for the full backup.
    await addMemberRow(env, ws, "editor@test.dev", "editor");
    const e = routerFor(env, { email: "editor@test.dev" });
    await expectApiError(e.request("GET", `/api/ws/${ws}/export/all`), 403, "forbidden");
  });

  it("answers 404 to outsiders without leaking existence", async () => {
    const env = makeTestEnv();
    await createWorkspace(env, "owner@test.dev", "Mine");
    const outsider = routerFor(env, { email: "nope@test.dev" });
    await expectApiError(
      outsider.request("GET", `/api/ws/some-ws/export/all`),
      404,
      "not_found",
    );
  });
});

describe("api routes: generate cooldown (spec §17)", () => {
  it("answers 429 rate_limited when a generation ran less than 30s ago", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Cooldown");
    await addEntry(env, ws, "kaat");
    const { router, drain } = scheduledRouterFor(env, "owner@test.dev");

    await router.request("POST", `/api/ws/${ws}/language/generate`, {});
    await drain(); // job 1 completes, staying inside the 30s window
    const err = await expectApiError(
      router.request("POST", `/api/ws/${ws}/language/generate`, {}),
      429,
      "rate_limited",
    );
    expect(err.message).toMatch(/30 seconds/i);
  });

  it("lets the request through once the last job is older than the cooldown", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Cooldown2");
    await addEntry(env, ws, "kaat");
    const jobId = await insertJobRow(env, ws, "owner@test.dev", "completed");
    await env.store.updateJob(jobId, {
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    const o = routerFor(env, { email: "owner@test.dev" });
    const res = (await o.request("POST", `/api/ws/${ws}/language/generate`, {})) as { jobId?: string };
    expect(res.jobId).toBeTruthy();
  });

  it("still answers 409 job_active when a job is live, before any cooldown", async () => {
    const env = makeTestEnv();
    const ws = await createWorkspace(env, "owner@test.dev", "Cooldown3");
    await addEntry(env, ws, "kaat");
    await insertJobRow(env, ws, "owner@test.dev", "running");
    const o = routerFor(env, { email: "owner@test.dev" });
    await expectApiError(
      o.request("POST", `/api/ws/${ws}/language/generate`, {}),
      409,
      "job_active",
    );
  });
});
