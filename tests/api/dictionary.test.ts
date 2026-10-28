import { describe, it, expect, beforeAll } from "vitest";
import { makeTestEnv, call, createWorkspace, type TestEnv } from "../helpers.js";

let env: TestEnv;
let user: string;
let wsId: string;

beforeAll(async () => {
  env = makeTestEnv();
  user = "dict@test.dev";
  wsId = await createWorkspace(env, user, "Dictionary Co");
});

async function post(body: Record<string, unknown>) {
  return call(env, user, "POST", `/api/ws/${wsId}/dictionary`, body);
}

describe("dictionary CRUD", () => {
  it("creates an entry with defaults", async () => {
    const res = await post({ word: "vethra", bengaliMeaning: "চুক্তি", englishMeaning: "agreement" });
    expect(res.status).toBe(201);
    expect(res.body.entry).toMatchObject({
      word: "vethra",
      bengaliMeaning: "চুক্তি",
      englishMeaning: "agreement",
      partOfSpeech: "noun",
      source: "user",
      status: "approved",
      learningStatus: "new",
      version: 1,
      archived: false
    });
  });

  it("rejects duplicates, including case/whitespace variants (normalization)", async () => {
    const dup = await post({ word: "vethra", englishMeaning: "again" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("conflict");
    expect(dup.body.error.details.existingWord).toBe("vethra");
    const spaced = await post({ word: "  VETHRA  ", englishMeaning: "again" });
    expect(spaced.status).toBe(409);
  });

  it("validates the payload", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ word: "kairum", partOfSpeech: "modal_verb" })).status).toBe(400);
  });

  it("updates an entry, bumps the version, and records history", async () => {
    const created = await post({ word: "solven", bengaliMeaning: "গোপনীয়", englishMeaning: "confidential" });
    const id = created.body.entry.id as string;
    const patch = await call(env, user, "PATCH", `/api/ws/${wsId}/dictionary/${id}`, { englishMeaning: "confidential / secret" });
    expect(patch.status).toBe(200);
    expect(patch.body.entry.version).toBe(2);
    expect(patch.body.entry.history).toHaveLength(1);
    expect(patch.body.entry.history[0].changes.englishMeaning).toEqual({ from: "confidential", to: "confidential / secret" });

    const noChange = await call(env, user, "PATCH", `/api/ws/${wsId}/dictionary/${id}`, { englishMeaning: "confidential / secret" });
    expect(noChange.body.message).toMatch(/nothing to update/i);
  });

  it("refuses a rename that collides with another word", async () => {
    const res = await call(env, user, "PATCH", `/api/ws/${wsId}/dictionary/${(await post({ word: "kairum" })).body.entry.id}`, { word: "Vethra" });
    expect(res.status).toBe(409);
  });

  it("archives instead of hard-deleting, and can restore", async () => {
    const created = await post({ word: "temporary" });
    const id = created.body.entry.id as string;
    const del = await call(env, user, "DELETE", `/api/ws/${wsId}/dictionary/${id}`);
    expect(del.status).toBe(200);
    expect((await call(env, user, "GET", `/api/ws/${wsId}/dictionary/${id}`)).status).toBe(404);
    const restore = await call(env, user, "POST", `/api/ws/${wsId}/dictionary/${id}/restore`);
    expect(restore.status).toBe(200);
    expect((await call(env, user, "GET", `/api/ws/${wsId}/dictionary/${id}`)).status).toBe(200);
  });
});

describe("list, search, filters", () => {
  beforeAll(async () => {
    await post({ word: "zibanu", bengaliMeaning: "চালান", englishMeaning: "invoice", partOfSpeech: "noun" });
    await post({ word: "porthomu", bengaliMeaning: "পাঠানো", englishMeaning: "send", partOfSpeech: "verb" });
  });

  it("paginates with totals", async () => {
    const res = await call(env, user, "GET", `/api/ws/${wsId}/dictionary?page=1&pageSize=2`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.total).toBeGreaterThanOrEqual(5);
  });

  it("searches across word, Bengali and English", async () => {
    for (const q of ["vethra", "চুক্তি", "agreement"]) {
      const res = await call(env, user, "GET", `/api/ws/${wsId}/dictionary?q=${encodeURIComponent(q)}`);
      expect(res.body.items.some((i: { word: string }) => i.word === "vethra")).toBe(true);
    }
  });

  it("filters by part of speech and sorts alphabetically case-insensitively", async () => {
    const verbs = await call(env, user, "GET", `/api/ws/${wsId}/dictionary?pos=verb`);
    expect(verbs.body.items.every((i: { partOfSpeech: string }) => i.partOfSpeech === "verb")).toBe(true);
    const alpha = await call(env, user, "GET", `/api/ws/${wsId}/dictionary?sort=alpha`);
    const words = (alpha.body.items as Array<{ word: string }>).map((i) => i.word.toLowerCase());
    expect(words).toEqual([...words].sort());
  });
});

describe("import / export", () => {
  it("previews a CSV and reports duplicates without writing anything", async () => {
    const csv = [
      "word,bengaliMeaning,englishMeaning,partOfSpeech",
      "durlob,দরকার,need,verb",
      "durlob,দরকার,need,verb",
      "vethra,চুক্তি,agreement,noun",
      "badrow,বাতিল,invalid,modal_verb"
    ].join("\n");
    const res = await call(env, user, "POST", `/api/ws/${wsId}/dictionary/import/preview`, { format: "csv", content: csv });
    expect(res.status).toBe(200);
    const report = res.body.report;
    expect(report.validCount).toBe(1);
    expect(report.duplicatesInFile).toHaveLength(1);
    expect(report.duplicatesInDictionary).toHaveLength(1); // vethra already exists
    expect(report.invalid).toHaveLength(1);
    const total = await call(env, user, "GET", `/api/ws/${wsId}/dictionary?pageSize=100`);
    expect((total.body.items as Array<{ word: string }>).some((i) => i.word === "durlob")).toBe(false);
  });

  it("commits the valid rows and marks them imported", async () => {
    const commit = await call(env, user, "POST", `/api/ws/${wsId}/dictionary/import/commit`, {
      rows: [{ word: "durlob", bengaliMeaning: "দরকার", englishMeaning: "need" }, { word: "shunno", bengaliMeaning: "শূন্য", englishMeaning: "zero" }]
    });
    expect(commit.status).toBe(200);
    expect(commit.body.imported).toBe(2);
    const list = await call(env, user, "GET", `/api/ws/${wsId}/dictionary?source=imported`);
    expect(list.body.items).toHaveLength(2);
  });

  it("rejects a commit with invalid rows payload", async () => {
    const res = await call(env, user, "POST", `/api/ws/${wsId}/dictionary/import/commit`, { rows: [{ englishMeaning: "no word" }] });
    expect(res.status).toBe(400);
  });

  it("rejects a CSV preview without a word column", async () => {
    const res = await call(env, user, "POST", `/api/ws/${wsId}/dictionary/import/preview`, { format: "csv", content: "bn,en\nচুক্তি,agreement" });
    expect(res.status).toBe(400);
  });

  it("exports as CSV and JSON envelopes, and audits the export", async () => {
    const csv = await call(env, user, "GET", `/api/ws/${wsId}/dictionary/export?format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.body.contentType).toContain("text/csv");
    expect(csv.body.content).toContain("word,bengaliMeaning,englishMeaning");
    expect(csv.body.content).toContain("vethra");

    const json = await call(env, user, "GET", `/api/ws/${wsId}/dictionary/export?format=json`);
    expect(json.status).toBe(200);
    const parsed = JSON.parse(json.body.content) as Array<{ word: string }>;
    expect(parsed.some((e) => e.word === "durlob")).toBe(true);

    const activity = await call(env, user, "GET", `/api/ws/${wsId}/activity`);
    const actions = (activity.body.items as Array<{ action: string }>).map((i) => i.action);
    expect(actions).toContain("dictionary.exported");
    expect(actions).toContain("dictionary.imported");
  });

  it("escapes commas and quotes in exported fields", async () => {
    await post({ word: "quotation", englishMeaning: 'said "hello", loudly' });
    const csv = await call(env, user, "GET", `/api/ws/${wsId}/dictionary/export?format=csv`);
    expect(csv.body.content).toContain('"said ""hello"", loudly"');
  });
});

describe("phrasebook + word builder", () => {
  it("saves and lists phrasebook entries scoped to the workspace", async () => {
    const save = await call(env, user, "POST", `/api/ws/${wsId}/phrasebook`, {
      sourceText: "The invoice is ready", sourceLang: "english", translatedText: "Zibanu porthomu", targetLang: "language"
    });
    expect(save.status).toBe(201);
    const list = await call(env, user, "GET", `/api/ws/${wsId}/phrasebook`);
    expect(list.body.items).toHaveLength(1);
    const remove = await call(env, user, "DELETE", `/api/ws/${wsId}/phrasebook/${list.body.items[0].id}`);
    expect(remove.status).toBe(200);
  });

  it("word builder suggests a pronounceable word and approval stores it as generated", async () => {
    const suggestion = await call(env, user, "POST", `/api/ws/${wsId}/word-builder/suggest`, { concept: "deadline", partOfSpeech: "noun" });
    expect(suggestion.status).toBe(200);
    expect(suggestion.body.suggestion.kind).toBe("suggestion");
    expect(suggestion.body.suggestion.word).toMatch(/^[a-z]{2,10}$/);
    expect(suggestion.body.suggestion.formation).toBeTruthy();

    const approve = await call(env, user, "POST", `/api/ws/${wsId}/word-builder/approve`, { ...suggestion.body.suggestion, englishMeaning: "deadline" });
    expect(approve.status).toBe(201);
    expect(approve.body.word).toBe(suggestion.body.suggestion.word);

    const dup = await call(env, user, "POST", `/api/ws/${wsId}/word-builder/approve`, { ...suggestion.body.suggestion, englishMeaning: "deadline" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("duplicate_word");
  });

  it("word builder surfaces an existing word instead of inventing a rival", async () => {
    const suggestion = await call(env, user, "POST", `/api/ws/${wsId}/word-builder/suggest`, { concept: "agreement", partOfSpeech: "noun" });
    expect(suggestion.body.suggestion.kind).toBe("existing");
    expect(suggestion.body.suggestion.word).toBe("vethra");
  });
});

describe("translation draft", () => {
  it("translates English into the language using the dictionary, marked draft", async () => {
    const res = await call(env, user, "POST", `/api/ws/${wsId}/translate`, { text: "I need the contract", from: "english", to: "language" });
    expect(res.status).toBe(200);
    expect(res.body.reviewStatus).toBe("draft");
    // "need" → durlob, "contract" → vethra; "I" has no dictionary entry.
    expect(res.body.unmapped).toEqual(["I"]);
    expect(res.body.confidence).toBeLessThan(1);
    expect(String(res.body.translation)).toContain("durlob");
    expect(String(res.body.translation)).toContain("vethra");
    const mapping = res.body.mapping as Array<{ source: string; target: string }>;
    expect(mapping.find((m) => m.source === "contract")?.target).toBe("vethra");
  });

  it("refuses translating a language to itself", async () => {
    const res = await call(env, user, "POST", `/api/ws/${wsId}/translate`, { text: "hello", from: "english", to: "english" });
    expect(res.status).toBe(400);
  });
});
