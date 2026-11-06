import { describe, it, expect, beforeAll } from "vitest";
import { makeTestEnv, createWorkspace, addEntry, type TestEnv } from "../helpers.js";
import { applyReview, getPracticeQueue, getPracticeStats } from "../../src/core/services/practice.js";
import { uid, nowIso } from "../../src/core/db/ids.js";

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
    entryIds.push(await addEntry(env, workspaceId, word, bn, en));
  }
  // A second learner on the same dictionary: progress must be per-user.
  // Membership keys on the email itself -- no local user rows.
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

  it("reviewed words leave the due queue until their window returns", async () => {
    const queue = await getPracticeQueue(env.store, workspaceId, user, "mixed", 10);
    expect(queue.some((q) => q.entryId === entryIds[0])).toBe(false); // reviewed → 1-day interval
    expect(queue.some((q) => q.entryId === entryIds[1])).toBe(false); // incorrect → back in 10 minutes
    expect(queue.some((q) => q.entryId === entryIds[2])).toBe(true); // never reviewed → due
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
    expect(stats.remembered).toBe(2); // [0] after 3 correct, [2] after 8
    expect(stats.needsRevision).toBe(1); // [1]
    expect(stats.learning).toBe(0);
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

describe("queue enrichment for the practice modes", () => {
  let ws2: string;
  let sentenceEntryId: string;

  beforeAll(async () => {
    ws2 = await createWorkspace(env, "enrich@test.dev", "Enrich");
    await addEntry(env, ws2, "vethra", "চুক্তি", "agreement");
    await addEntry(env, ws2, "solven", "গোপনীয়", "confidential");
    await addEntry(env, ws2, "kairum", "অনুমোদন", "approval");
    // One entry carries a stored example sentence that uses its own word.
    sentenceEntryId = uid();
    const now = nowIso();
    await env.store.insertEntry({
      id: sentenceEntryId,
      workspace_id: ws2,
      language_id: null,
      word: "malvun",
      normalized_word: "malvun",
      bengali_meaning: "চালান",
      english_meaning: "shipment",
      pronunciation_guide: "mal-vun",
      ipa: "",
      part_of_speech: "noun",
      root: "",
      word_formation_explanation: "",
      prefixes: "",
      suffixes: "",
      grammar_notes: "",
      example_sentences_json: JSON.stringify([
        {
          id: uid(),
          constructed: "Bonivar malvun auroven purnaka.",
          bengali: "গ্রাহকের চালান পৌঁছেছে।",
          english: "The customer's shipment has arrived.",
          gloss: [],
          grammarNotes: "",
          reviewStatus: "approved"
        }
      ]),
      related_word_ids_json: "[]",
      mnemonic: "",
      learning_status: "new",
      source: "user",
      status: "approved",
      archived: 0,
      entry_version: 1,
      history_json: "[]",
      created_at: now,
      updated_at: now
    });
  });

  it("builds deterministic MCQ options with the answer shuffled in", async () => {
    const mcq = await getPracticeQueue(env.store, ws2, "enrich@test.dev", "bengali_to_word", 10);
    expect(mcq.length).toBe(4);
    for (const item of mcq) {
      expect(item.options).toBeTruthy();
      expect(item.options).toContain(item.word);
      expect(new Set(item.options).size).toBe(item.options!.length); // no duplicate options
      expect(item.options!.length).toBe(4); // answer + 3 distinct distractors
    }
    const second = await getPracticeQueue(env.store, ws2, "enrich@test.dev", "bengali_to_word", 10);
    expect(second.map((i) => i.options)).toEqual(mcq.map((i) => i.options));
  });

  it("blanks the target word inside its example sentence for fill_blank", async () => {
    const queue = await getPracticeQueue(env.store, ws2, "enrich@test.dev", "fill_blank", 10);
    const item = queue.find((i) => i.entryId === sentenceEntryId);
    expect(item?.contextSentence).toBeTruthy();
    expect(item?.contextSentence).not.toMatch(/malvun/i);
    expect(item?.contextSentence).toContain("____");
  });

  it("leaves typed and self-report modes without options or context", async () => {
    const typed = await getPracticeQueue(env.store, ws2, "enrich@test.dev", "word_to_bengali", 10);
    expect(typed.length).toBe(4);
    expect(typed.every((i) => i.options === undefined && i.contextSentence === undefined)).toBe(true);

    const spoken = await getPracticeQueue(env.store, ws2, "enrich@test.dev", "pronunciation", 10);
    expect(spoken.every((i) => i.options === undefined)).toBe(true);
  });
});
