import { describe, it, expect, beforeAll } from "vitest";
import { makeTestEnv, call, type TestEnv } from "../helpers.js";

/* Identity is Blocks IAM now: the SPA's hosted-login token IS the session,
 * and the function resolves the caller's email server-side. There are no
 * local accounts, cookies or password routes to test -- what remains
 * testable here is the /me contract the SPA seeds its session from. */

let env: TestEnv;
const email = "auth@test.dev";

beforeAll(() => {
  env = makeTestEnv();
});

describe("the /me contract", () => {
  it("returns the caller's identity and an empty workspace list for a fresh email", async () => {
    const me = await call(env, email, "GET", "/api/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);
    expect(me.body.user.emailVerified).toBe(true);
    expect(me.body.workspaces).toEqual([]);
  });

  it("workspaces appear after the caller creates one", async () => {
    const ws = await call(env, email, "POST", "/api/workspaces", { name: "Auth Co" });
    expect(ws.status).toBe(201);
    const me = await call(env, email, "GET", "/api/me");
    expect((me.body.workspaces as Array<{ name: string }>).map((w) => w.name)).toContain("Auth Co");
  });
});
