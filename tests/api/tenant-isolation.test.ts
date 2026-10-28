import { describe, it, expect, beforeAll } from "vitest";
import { makeTestEnv, call, createWorkspace, addEntry, type TestEnv } from "../helpers.js";

/* The core security guarantees of the product (spec §14, §20):
 * every workspace-scoped read/write is authorized inside the function, a
 * missing membership answers 404 (no existence probing), and roles gate
 * actions. Identity itself is platform-owned: the function trigger requires
 * a Blocks token (verified live -- an M2M call gets 401), so cookie/CSRF
 * tests from the Express era no longer apply. */

let env: TestEnv;
let alice: string; // owner of workspace A
let bobby: string; // owner of workspace B
let wsA: string;
let wsB: string;
let entryA: string;
let entryB: string;
let viewer: string;
let editor: string;

async function addWord(user: string, wsId: string, word: string): Promise<string> {
  return addEntry(env, user, wsId, word, "পরীক্ষা", "test word " + word);
}

beforeAll(async () => {
  env = makeTestEnv();
  alice = "alice@a.test";
  bobby = "bobby@b.test";
  viewer = "viewer@v.test";
  editor = "editor@e.test";
  wsA = await createWorkspace(env, alice, "Alice Trading");
  wsB = await createWorkspace(env, bobby, "Bobby Ventures");
  entryA = await addWord(alice, wsA, "aword");
  entryB = await addWord(bobby, wsB, "bsecret");

  // Give the viewer/editor accounts roles inside workspace A only.
  await call(env, alice, "POST", `/api/ws/${wsA}/members`, { email: viewer, role: "viewer" });
  await call(env, alice, "POST", `/api/ws/${wsA}/members`, { email: editor, role: "editor" });
});

describe("cross-tenant access is impossible", () => {
  it("a non-member gets 404 — not 403 — on another tenant's workspace", async () => {
    const res = await call(env, alice, "GET", `/api/ws/${wsB}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });

  it("cannot read the other tenant's dictionary, dashboard or activity", async () => {
    for (const path of ["dictionary", "dashboard", "activity", "members", "security"]) {
      const res = await call(env, alice, "GET", `/api/ws/${wsB}/${path}`);
      expect(res.status).toBe(404);
    }
  });

  it("cannot search or export the other tenant's dictionary", async () => {
    const search = await call(env, alice, "GET", `/api/ws/${wsB}/dictionary?q=secret`);
    expect(search.status).toBe(404);
    const csv = await call(env, alice, "GET", `/api/ws/${wsB}/dictionary/export`);
    expect(csv.status).toBe(404);
  });

  it("cannot write into the other tenant's workspace", async () => {
    const post = await call(env, alice, "POST", `/api/ws/${wsB}/dictionary`, { word: "intruder" });
    expect(post.status).toBe(404);
    const gen = await call(env, alice, "POST", `/api/ws/${wsB}/language/generate`, {});
    expect(gen.status).toBe(404);
    const translate = await call(env, alice, "POST", `/api/ws/${wsB}/translate`, { text: "hello", from: "english", to: "bengali" });
    expect(translate.status).toBe(404);
  });

  it("cannot touch the other tenant's entry even with a forged workspace id in the URL", async () => {
    const get = await call(env, alice, "GET", `/api/ws/${wsA}/dictionary/${entryB}`);
    expect(get.status).toBe(404);
    const patch = await call(env, alice, "PATCH", `/api/ws/${wsA}/dictionary/${entryB}`, { englishMeaning: "stolen" });
    expect(patch.status).toBe(404);
    const del = await call(env, alice, "DELETE", `/api/ws/${wsA}/dictionary/${entryB}`);
    expect(del.status).toBe(404);
    const review = await call(env, alice, "POST", `/api/ws/${wsA}/practice/review`, { entryId: entryB, mode: "word_to_bengali", correct: true });
    expect(review.status).toBe(404);
  });

  it("a fabricated workspace id behaves exactly like someone else's", async () => {
    const res = await call(env, alice, "GET", "/api/ws/00000000-0000-0000-0000-000000000000/dictionary");
    expect(res.status).toBe(404);
  });

  it("the workspace list only ever shows your own memberships", async () => {
    const mine = await call(env, alice, "GET", "/api/me");
    const ids = (mine.body.workspaces as Array<{ id: string }>).map((w) => w.id);
    expect(ids).toContain(wsA);
    expect(ids).not.toContain(wsB);
  });

  it("B cannot escalate by adding themselves to A's workspace", async () => {
    const res = await call(env, bobby, "POST", `/api/ws/${wsA}/members`, { email: bobby, role: "admin" });
    expect(res.status).toBe(403);
  });
});

describe("roles gate actions server-side", () => {
  it("a viewer can read but not write", async () => {
    const read = await call(env, viewer, "GET", `/api/ws/${wsA}/dictionary`);
    expect(read.status).toBe(200);
    const write = await call(env, viewer, "POST", `/api/ws/${wsA}/dictionary`, { word: "nope" });
    expect(write.status).toBe(403);
    const generate = await call(env, viewer, "POST", `/api/ws/${wsA}/language/generate`, {});
    expect(generate.status).toBe(403);
    const manage = await call(env, viewer, "POST", `/api/ws/${wsA}/members`, { email: bobby, role: "viewer" });
    expect(manage.status).toBe(403);
  });

  it("an editor can write words but not manage members or delete the workspace", async () => {
    const write = await call(env, editor, "POST", `/api/ws/${wsA}/dictionary`, { word: "editorword" });
    expect(write.status).toBe(201);
    const manage = await call(env, editor, "PATCH", `/api/ws/${wsA}/members/${entryA}`, { role: "viewer" });
    expect(manage.status).toBe(403);
    const del = await call(env, editor, "DELETE", `/api/ws/${wsA}`);
    expect(del.status).toBe(403);
  });

  it("the owner account cannot be removed or demoted", async () => {
    const members = await call(env, alice, "GET", `/api/ws/${wsA}/members`);
    const owner = (members.body.members as Array<{ user_id: string; role: string }>).find((m) => m.role === "owner")!;
    const remove = await call(env, alice, "DELETE", `/api/ws/${wsA}/members/${owner.user_id}`);
    expect(remove.status).toBe(400);
    const demote = await call(env, alice, "PATCH", `/api/ws/${wsA}/members/${owner.user_id}`, { role: "viewer" });
    expect(demote.status).toBe(400);
  });
});
