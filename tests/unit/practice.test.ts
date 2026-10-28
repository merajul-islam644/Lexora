import { describe, it, expect, beforeAll } from "vitest";
import { makeTestEnv, call, createWorkspace, addEntry, type TestEnv } from "../helpers.js";
import { applyReview, getPracticeQueue, getPracticeStats } from "../../src/core/services/practice.js";

let env: TestEnv;
let user: string;
let otherUser: string;
let workspaceId: string;
const entryIds: string[] = [];

beforeAll(async () => {
  env = makeTestEnv();
  user = "srs@test.dev";
  otherUser = "other@test.dev";

  workspaceId = await createWorkspace(env, user, "SRS Workspace");
  for (const [word, bn, en] of [
    ["vethra", "চুক্তি", "contract"],
    ["solven", "গোপনীয়", "confidential"],
    ["kairum", "অনুমোদন", "approval"]
  ]) {
    entryIds.push(await addEntry(env, user, workspaceId, word, bn, en));
  }
  // A second learner on the same dictionary: progress must be per-user.
  // Membership keys on the email itself now -- no local user rows.
});

describe("spaced repetition math (SM-2 inspired)", () => {
  it("a new word is due immediately", async () => {
    const queue = await getPracticeQueue(env.store, workspaceId, user, "mixed", 10);
    expect(queue).toHaveLength(3);
    expect(queue.every((q) => q.status === "new")).toBe(true);
  });

  it("first correct answer: 1 day interval, learning", async () => {
    const result = await applyReview(env.store, { workspaceId, userId: user, entryId: entryIds[0]!, mode: "word_to_bengali", correct: true });
    expect(result.status).toBe("learning");
    expect(result.correctCount).toBe(1);
    const days = (new Date(result.nextReviewAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(0.9);
    expect(days).toBeLessThan(1.1);
  });

  it("second correct answer grows the interval (×2.4)", async () => {
    const result = await applyReview(env.store, { workspaceId, userId: user, entryId: entryIds[0]!, mode: "word_to_bengali", correct: true });
    const days = (new Date(result.nextReviewAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(2.3);
    expect(days).toBeLessThan(2.5);
  });

  it("third correct answer marks the word remembered", async () => {
    const result = await applyReview(env.store, { workspaceId, userId: user, entryId: entryIds[0]!, mode: "word_to_bengali", correct: true });
    expect(result.status).toBe("remembered");
  });

  it("an incorrect answer resets to a 10-minute revision window", async () => {
    const result = await applyReview(env.store, { workspaceId, userId: user, entryId: entryIds[1]!, mode: "word_to_english", correct: false });
    expect(result.status).toBe("needs_revision");
    expect(result.incorrectCount).toBe(1);
    const minutes = (new Date(result.nextReviewAt).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(8);
    expect(minutes).toBeLessThan(11);
  });

  it("a scheduled word leaves the due queue; the reset one stays", async () => {
    const queue = await getPracticeQueue(env.store, workspaceId, user, "mixed", 10);
    expect(queue.some((q) => q.entryId === entryIds[0])).toBe(false); // reviewed → 1-day interval
    expect(queue.some((q) => q.entryId === entryIds[1])).toBe(true); // incorrect → due in 10 min
  });

  it("caps the interval at 60 days", async () => {
    for (let i = 0; i < 8; i++) {
      const result = await applyReview(env.store, { workspaceId, userId: user, entryId: entryIds[2]!, mode: "fill_blank", correct: true });
      const days = (new Date(result.nextReviewAt).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeLessThanOrEqual(61);
    }
  });

  it("stats reflect per-user progress", async () => {
    const stats = await getPracticeStats(env.store, workspaceId, user);
    expect(stats.total).toBe(3);
    expect(stats.remembered).toBe(1);
    expect(stats.needsRevision).toBe(1);
    expect(stats.learning).toBe(1);
    expect(stats.lastReviewedAt).not.toBeNull();
  });

  it("another user's progress starts independent", async () => {
    const stats = await getPracticeStats(env.store, workspaceId, otherUser);
    expect(stats.remembered).toBe(0);
    expect(stats.dueNow).toBe(3);
  });

  it("rejects a review for a word outside the workspace", async () => {
    await expect(
      applyReview(env.store, { workspaceId, userId: user, entryId: "no-such-entry", mode: "fill_blank", correct: true })
    ).rejects.toThrowError();
  });
});
