import { describe, it, expect } from "vitest";
import { diffProfiles } from "../../src/core/services/languageDiff.js";
import { GenerationEngine } from "../../src/core/services/generator/index.js";
import type { LanguageProfile } from "../../src/shared/schemas.js";
import type { EntryRow } from "../../src/core/db/rows.js";

/* Two real engine profiles (same seed) as the diff's raw material -- the same
 * shape version snapshots carry. */

function makeEntry(partial: Partial<EntryRow> & { id: string; word?: string }): EntryRow {
  const now = new Date().toISOString();
  return {
    id: partial.id,
    workspace_id: "ws1",
    language_id: null,
    word: partial.word ?? "",
    normalized_word: (partial.word ?? "").toLowerCase(),
    bengali_meaning: partial.bengali_meaning ?? "",
    english_meaning: partial.english_meaning ?? "",
    pronunciation_guide: "",
    ipa: "",
    part_of_speech: partial.part_of_speech ?? "noun",
    root: "",
    word_formation_explanation: "",
    prefixes: "",
    suffixes: "",
    grammar_notes: "",
    example_sentences_json: "[]",
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
  };
}

function runProfile(): LanguageProfile {
  const engine = new GenerationEngine({
    workspaceName: "Diff Co",
    entries: [
      makeEntry({ id: "e1", english_meaning: "agreement", bengali_meaning: "চুক্তি", part_of_speech: "noun" }),
      makeEntry({ id: "e2", english_meaning: "approve", bengali_meaning: "অনুমোদন করা", part_of_speech: "verb" })
    ],
    style: "naturalistic",
    referenceLangs: "both",
    existingNames: new Set<string>(),
    existingWords: new Set<string>(),
    seed: 991,
    version: 1
  });
  for (const stage of ["reviewing_dictionary", "sound_rules", "vocabulary", "grammar", "consistency"] as const) {
    engine.runStage(stage);
  }
  return engine.buildProfile();
}

function clone(profile: LanguageProfile): LanguageProfile {
  return JSON.parse(JSON.stringify(profile)) as LanguageProfile;
}

describe("diffProfiles", () => {
  it("reports no visible changes for identical profiles", () => {
    const a = runProfile();
    const diff = diffProfiles(a, clone(a));
    expect(diff.summary).toBe("No visible changes");
    expect(diff.nameChanged).toBe(false);
    expect(diff.wordOrderChanged).toBe(false);
    expect(diff.rulesAdded).toHaveLength(0);
    expect(diff.rulesRemoved).toHaveLength(0);
    expect(diff.rulesChanged).toHaveLength(0);
    expect(diff.vocabAdded).toHaveLength(0);
    expect(diff.vocabRemoved).toHaveLength(0);
    expect(diff.newWarnings).toHaveLength(0);
    expect(diff.resolvedWarnings).toHaveLength(0);
  });

  it("detects a renamed language", () => {
    const a = runProfile();
    const b = clone(a);
    b.name = "Zintra";
    const diff = diffProfiles(a, b);
    expect(diff.nameChanged).toBe(true);
    expect(diff.fromName).toBe(a.name);
    expect(diff.toName).toBe("Zintra");
    expect(diff.summary).toMatch(/name/);
  });

  it("detects added, removed and updated rules by id", () => {
    const a = runProfile();
    const b = clone(a);
    const removed = b.grammarRules[1]!;
    const updated = { ...b.grammarRules[2]!, explanationEnglish: "Now explained differently." };
    const added = {
      ...b.grammarRules[0]!,
      id: "brand-new-rule",
      name: "A rule that did not exist"
    };
    // Keep rule 0 as-is, swap rule 2 for the updated copy, insert the new
    // rule, drop rule 1 -- so exactly one rule is added, removed, changed.
    b.grammarRules = [b.grammarRules[0]!, updated, added, ...b.grammarRules.slice(3)];
    const diff = diffProfiles(a, b);
    expect(diff.rulesRemoved.map((r) => r.id)).toContain(removed.id);
    expect(diff.rulesAdded.map((r) => r.id)).toContain("brand-new-rule");
    expect(diff.rulesChanged).toHaveLength(1);
    expect(diff.rulesChanged[0]?.before.id).toBe(updated.id);
    expect(diff.rulesChanged[0]?.after.explanationEnglish).toBe("Now explained differently.");
    expect(diff.summary).toMatch(/1 rules? added/);
    expect(diff.summary).toMatch(/1 rules? removed/);
    expect(diff.summary).toMatch(/1 rules? updated/);
  });

  it("detects vocabulary added and removed by normalized word", () => {
    const a = runProfile();
    const b = clone(a);
    const dropped = b.vocabulary[0]!;
    b.vocabulary = [
      ...b.vocabulary.slice(1),
      { ...dropped, word: "Xylophone-Brandnew", bengaliMeaning: "নতুন", englishMeaning: "brand new" }
    ];
    const diff = diffProfiles(a, b);
    expect(diff.vocabRemoved.map((v) => v.word)).toContain(dropped.word);
    expect(diff.vocabAdded.map((v) => v.word)).toContain("Xylophone-Brandnew");
    expect(diff.summary).toMatch(/words? added/);
    expect(diff.summary).toMatch(/words? removed/);
  });

  it("diffs consistency warnings both ways", () => {
    const a = runProfile();
    const b = clone(a);
    b.consistencyWarnings = [
      ...b.consistencyWarnings.filter((w) => w !== a.consistencyWarnings[0]),
      "A brand-new warning appeared."
    ];
    const diff = diffProfiles(a, b);
    expect(diff.newWarnings).toContain("A brand-new warning appeared.");
    if (a.consistencyWarnings[0]) {
      expect(diff.resolvedWarnings).toContain(a.consistencyWarnings[0]);
    }
  });

  it("detects word order changes", () => {
    const a = runProfile();
    const b = clone(a);
    b.wordOrder = a.wordOrder === "SOV" ? "SVO" : "SOV";
    const diff = diffProfiles(a, b);
    expect(diff.wordOrderChanged).toBe(true);
    expect(diff.summary).toMatch(/word order/);
  });
});
