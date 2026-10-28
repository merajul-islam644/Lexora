import { uid, nowIso, normalizeWord } from "../db/ids.js";
import { logActivity } from "./activity.js";
import { HttpError } from "../lib/http.js";
import type { EntryRow, LanguageRow } from "../db/rows.js";
import type { DataStore } from "../db/store.js";
import {
  toIpa,
  guideFromSyllables,
  buildPhonology,
  generateWord,
  mulberry32,
  hashSeed,
} from "./generator/core.js";
import type { LanguageProfile, PartOfSpeech } from "../../shared/schemas.js";

export interface WordSuggestion {
  kind: "suggestion" | "existing";
  word: string;
  bengaliMeaning: string;
  englishMeaning: string;
  pronunciationGuide: string;
  ipa: string;
  partOfSpeech: PartOfSpeech;
  root: string;
  formation: string;
  relatedWords: Array<{ word: string; meaning: string }>;
  ruleReference: string;
  existingEntryId?: string;
}

function phonologyFromProfile(profile: LanguageProfile | null) {
  if (!profile) return buildPhonology(mulberry32(1), "naturalistic");
  return {
    consonants: profile.phonology.consonants,
    vowels: profile.phonology.vowels,
    codas: ["n"],
    syllableStructures: profile.phonology.syllableStructures,
    stressRule: profile.phonology.stressRule,
    forbiddenClusters: profile.phonology.forbiddenClusters,
    minSyllables: 1,
    maxSyllables: 3,
    conventions: profile.phonology.pronunciationConventions,
  };
}

function derivationSuffixFor(
  profile: LanguageProfile | null,
  pos: PartOfSpeech,
): { suffix: string; label: string } | null {
  if (!profile) return null;
  const keyword =
    pos === "verb"
      ? "verb"
      : pos === "adjective"
        ? "adjective"
        : pos === "adverb"
          ? "adverb"
          : "noun";
  const hit = profile.wordFormation.suffixes.find((s) =>
    s.meaning.toLowerCase().includes(keyword),
  );
  if (!hit) return null;
  return { suffix: hit.affix.replace(/^-/, ""), label: hit.affix };
}

/**
 * Word Builder: proposes a word that follows the language's established
 * phonology and derivation rules, checks collisions, and explains itself.
 */
export async function suggestWord(
  store: DataStore,
  workspaceId: string,
  params: { concept: string; partOfSpeech: PartOfSpeech },
): Promise<WordSuggestion> {
  const language = await store.getLanguageByWorkspace(workspaceId);
  const profile = language
    ? (JSON.parse(language.profile_json) as LanguageProfile)
    : null;
  const entries = await store.findEntries(workspaceId);

  const conceptLower = params.concept.toLowerCase().trim();
  const conceptTokens = conceptLower
    .split(/[\s,/]+/)
    .filter((t) => t.length > 1);

  // Existing entry with this meaning? Surface it instead of inventing a rival.
  const existing = entries.find(
    (e) =>
      (e.english_meaning && e.english_meaning.toLowerCase() === conceptLower) ||
      (e.bengali_meaning && e.bengali_meaning === params.concept.trim()),
  );
  if (existing) {
    return {
      kind: "existing",
      word: existing.word,
      bengaliMeaning: existing.bengali_meaning,
      englishMeaning: existing.english_meaning,
      pronunciationGuide: existing.pronunciation_guide,
      ipa: existing.ipa,
      partOfSpeech: existing.part_of_speech as PartOfSpeech,
      root: existing.root,
      formation: existing.word_formation_explanation,
      relatedWords: [],
      ruleReference: "Already in your dictionary",
      existingEntryId: existing.id,
    };
  }

  // Related words share a meaning token — they may donate their root.
  const related = entries
    .filter((e) => {
      const hay = `${e.english_meaning} ${e.bengali_meaning}`.toLowerCase();
      return conceptTokens.some((tok) => hay.includes(tok));
    })
    .slice(0, 4);

  const taken = new Set(entries.map((e) => e.normalized_word));
  const phon = phonologyFromProfile(profile);
  const seed = hashSeed(
    `${workspaceId}:${conceptLower}:${params.partOfSpeech}`,
  );

  let word: string;
  let root: string;
  let formation: string;

  const donor = related.find((r) => r.root && r.root.length >= 3);
  const derivation = derivationSuffixFor(profile, params.partOfSpeech);
  if (donor && derivation) {
    root = donor.root;
    const candidate = root + derivation.suffix;
    if (!taken.has(candidate)) {
      word = candidate;
      formation = `root "${root}" (from “${donor.english_meaning || donor.bengali_meaning}”) + ${params.partOfSpeech} suffix ${derivation.label}, per the word-formation rule`;
    } else {
      const fresh = generateWord(mulberry32(seed), phon, taken);
      word = fresh.word;
      root = fresh.word;
      formation = `fresh root following the language's syllable rules (${phon.syllableStructures.join(", ")})`;
    }
  } else {
    const fresh = generateWord(mulberry32(seed), phon, taken);
    word = fresh.word;
    root = fresh.word;
    formation = `fresh root following the language's syllable rules (${phon.syllableStructures.join(", ")})`;
  }

  const suggestion: WordSuggestion = {
    kind: "suggestion",
    word,
    bengaliMeaning: /[ঀ-৿]/.test(params.concept) ? params.concept.trim() : "",
    englishMeaning: !/[ঀ-৿]/.test(params.concept) ? params.concept.trim() : "",
    pronunciationGuide: guideFromSyllables([word]),
    ipa: toIpa(word),
    partOfSpeech: params.partOfSpeech,
    root,
    formation,
    relatedWords: related.map((r) => ({
      word: r.word,
      meaning: r.english_meaning || r.bengali_meaning,
    })),
    ruleReference: "word_formation",
  };
  return suggestion;
}

export async function approveSuggestedWord(
  store: DataStore,
  workspaceId: string,
  userId: string,
  payload: {
    word: string;
    bengaliMeaning?: string;
    englishMeaning?: string;
    pronunciationGuide?: string;
    partOfSpeech?: PartOfSpeech;
    root?: string;
    wordFormationExplanation?: string;
    mnemonic?: string;
  },
): Promise<{ id: string; word: string }> {
  const norm = normalizeWord(payload.word);
  const dup = await store.findEntryByNormalized(workspaceId, norm, { includeArchived: true });
  if (dup) {
    throw new HttpError(
      409,
      `"${dup.word}" already exists in this dictionary.`,
      "duplicate_word",
    );
  }
  const id = uid();
  const now = nowIso();
  const language = await store.getLanguageByWorkspace(workspaceId);
  await store.insertEntry({
    id,
    workspace_id: workspaceId,
    language_id: language?.id ?? null,
    word: payload.word.trim(),
    normalized_word: norm,
    bengali_meaning: payload.bengaliMeaning ?? "",
    english_meaning: payload.englishMeaning ?? "",
    pronunciation_guide: payload.pronunciationGuide ?? "",
    ipa: toIpa(payload.word),
    part_of_speech: payload.partOfSpeech ?? "noun",
    root: payload.root ?? "",
    word_formation_explanation: payload.wordFormationExplanation ?? "",
    prefixes: "",
    suffixes: "",
    grammar_notes: "",
    example_sentences_json: "[]",
    related_word_ids_json: "[]",
    mnemonic: payload.mnemonic ?? "",
    learning_status: "new",
    source: "generated",
    status: "approved",
    archived: 0,
    entry_version: 1,
    history_json: "[]",
    created_at: now,
    updated_at: now,
  });
  await logActivity(store, {
    workspaceId,
    actorUserId: userId,
    action: "dictionary.word_added",
    resourceType: "dictionary_entry",
    resourceId: id,
    metadata: { word: payload.word.trim(), via: "word_builder" },
  });
  return { id, word: payload.word.trim() };
}
