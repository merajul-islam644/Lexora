import { normalizeWord } from "../db/ids.js";
import type { EntryRow, LanguageRow } from "../db/rows.js";
import type { LanguageProfile, PartOfSpeech } from "../../shared/schemas.js";
import type { DataStore } from "../db/store.js";

export interface MappingRow {
  source: string;
  target: string;
  meaning: string;
  note?: string;
}

export interface TranslationResult {
  translation: string;
  mapping: MappingRow[];
  ruleReferences: string[];
  confidence: number;
  reviewStatus: "draft";
  alternatives: string[];
  unmapped: string[];
}

const STOPWORDS_EN = new Set([
  "the", "a", "an", "of", "to", "in", "on", "at", "for", "with", "that", "this",
  "it", "please", "my", "our", "your", "their", "his", "her", "its"
]);

const BN_CLITICS = ["গুলো", "গুলি", "টি", "টা", "কে", "তে", "র", "ের", "টির"];

const EN_AUX_MAP: Record<string, { lemma: string; tense?: "past" | "future" }> = {
  will: { lemma: "be", tense: "future" },
  is: { lemma: "be" },
  are: { lemma: "be" },
  am: { lemma: "be" },
  was: { lemma: "be", tense: "past" },
  were: { lemma: "be", tense: "past" },
  be: { lemma: "be" }
};

const EN_PRONOUN_MAP: Record<string, string> = {
  i: "I", we: "we", you: "you", they: "they", he: "they", she: "they",
  me: "I", us: "we", them: "they", him: "they", her: "they"
};

export async function getLanguageForWorkspace(store: DataStore, workspaceId: string): Promise<LanguageRow | null> {
  const row = await store.getLanguageByWorkspace(workspaceId);
  return row ?? null;
}

export function getProfile(language: LanguageRow): LanguageProfile | null {
  try {
    return JSON.parse(language.profile_json) as LanguageProfile;
  } catch {
    return null;
  }
}

function tokenize(text: string): Array<{ raw: string; word: string; isWord: boolean }> {
  const parts = text.split(/(\s+)/);
  return parts
    .filter((p) => p.length > 0)
    .map((p) => {
      const cleaned = p.replace(/[.,!?;:()"“”'’-]+$/g, "").replace(/^[.,!?;:()"“”'’-]+/g, "");
      return { raw: p, word: cleaned, isWord: cleaned.length > 0 && /[a-zA-Zঀ-৿]/.test(cleaned) };
    });
}

function findByEnglish(entries: EntryRow[], token: string): EntryRow | null {
  const t = token.toLowerCase();
  const exact = entries.find((e) => e.english_meaning.toLowerCase() === t);
  if (exact) return exact;
  const singular = t.endsWith("es") ? t.slice(0, -2) : t.endsWith("s") ? t.slice(0, -1) : null;
  if (singular) {
    const hit = entries.find((e) => e.english_meaning.toLowerCase() === singular);
    if (hit) return hit;
  }
  return null;
}

function findByBengali(entries: EntryRow[], token: string): EntryRow | null {
  const exact = entries.find((e) => e.bengali_meaning === token);
  if (exact) return exact;
  for (const clitic of BN_CLITICS) {
    if (token.endsWith(clitic) && token.length > clitic.length) {
      const stem = token.slice(0, -clitic.length);
      const hit = entries.find((e) => e.bengali_meaning === stem);
      if (hit) return hit;
    }
  }
  return null;
}

interface AffixInfo {
  plural: string;
  past: string;
  future: string;
  negation: string;
  question: string;
  genitive: string;
  formal: string;
}

function affixInfoFromProfile(profile: LanguageProfile | null): AffixInfo {
  const empty: AffixInfo = { plural: "", past: "", future: "", negation: "", question: "", genitive: "", formal: "" };
  if (!profile) return empty;
  const stored = (profile as LanguageProfile & {
    affixes?: Partial<AffixInfo>;
  }).affixes;
  if (!stored) return empty;
  return { ...empty, ...stored };
}

function findByWord(entries: EntryRow[], token: string, affixes: AffixInfo): { entry: EntryRow; grammar: string[] } | null {
  const norm = normalizeWord(token);
  const exact = entries.find((e) => e.normalized_word === norm);
  if (exact) return { entry: exact, grammar: [] };
  const stripEnds: Array<{ suffix: string; note: string }> = [];
  if (affixes.plural) stripEnds.push({ suffix: affixes.plural, note: "plural" });
  if (affixes.future) stripEnds.push({ suffix: affixes.future, note: "future tense" });
  if (affixes.past) stripEnds.push({ suffix: affixes.past, note: "past tense" });
  for (const { suffix, note } of stripEnds) {
    if (suffix && norm.endsWith(suffix) && norm.length > suffix.length) {
      const stem = norm.slice(0, -suffix.length);
      const hit = entries.find((e) => e.normalized_word === stem);
      if (hit) return { entry: hit, grammar: [note] };
    }
  }
  return null;
}

function ruleNamesFor(profile: LanguageProfile | null, ids: string[]): string[] {
  if (!profile) return [];
  return profile.grammarRules.filter((r) => ids.includes(r.id)).map((r) => r.name);
}

/**
 * Rule-based draft translation using the workspace's own dictionary and
 * grammar. Output is always marked draft — it is a memory aid built from the
 * user's words, not fluent machine translation (spec §12).
 */
export async function translate(
  store: DataStore,
  workspaceId: string,
  params: { text: string; from: "bengali" | "english" | "language"; to: "bengali" | "english" | "language" }
): Promise<TranslationResult> {
  const language = await getLanguageForWorkspace(store, workspaceId);
  const profile = language ? getProfile(language) : null;
  const entries = await store.findEntries(workspaceId);
  const affixes = affixInfoFromProfile(profile);
  const wordOrder = profile?.wordOrder ?? "SOV";

  const tokens = tokenize(params.text);
  const mapping: MappingRow[] = [];
  const unmapped: string[] = [];
  const alternatives: string[] = [];
  const ruleIds = new Set<string>();

  if (params.from === "language") {
    // Constructed → reference language: strip affixes, look up each word.
    const glosses: Array<{ text: string; entry: EntryRow | null; grammar: string[] }> = [];
    for (const t of tokens) {
      if (!t.isWord) continue;
      const hit = findByWord(entries, t.word, affixes);
      if (hit) {
        glosses.push({ text: t.word, entry: hit.entry, grammar: hit.grammar });
        mapping.push({
          source: t.word,
          target: params.to === "english" ? hit.entry.english_meaning || "?" : hit.entry.bengali_meaning || "?",
          meaning: `${hit.entry.english_meaning || "?"} / ${hit.entry.bengali_meaning || "?"}`,
          note: hit.grammar.length > 0 ? hit.grammar.join(", ") : undefined
        });
      } else {
        glosses.push({ text: t.word, entry: null, grammar: [] });
        unmapped.push(t.word);
        mapping.push({ source: t.word, target: `[${t.word}]`, meaning: "unmapped", note: "not in dictionary" });
      }
    }
    const parts = glosses.map((g) => (g.entry ? (params.to === "english" ? g.entry.english_meaning : g.entry.bengali_meaning) : `[${g.text}]`));
    const mappedCount = glosses.filter((g) => g.entry).length;
    return {
      translation: parts.join(" "),
      mapping,
      ruleReferences: ruleNamesFor(profile, ["word_order"]),
      confidence: glosses.length > 0 ? mappedCount / glosses.length : 0,
      reviewStatus: "draft",
      alternatives,
      unmapped
    };
  }

  // Reference language → constructed (or → the other reference language).
  const sourceIsEnglish = params.from === "english";
  const meaningOf = (entry: EntryRow): string => (params.to === "bengali" ? entry.bengali_meaning : entry.word);

  interface Slot { kind: "subject" | "verb" | "object" | "other"; text: string; entry?: EntryRow; note?: string }
  const slots: Slot[] = [];
  let tense: "past" | "future" | undefined;
  let negated = false;
  let question = false;
  if (/\?/.test(params.text)) question = true;

  let contentCount = 0;
  let mappedCount = 0;

  for (const t of tokens) {
    if (!t.isWord) continue;
    const raw = t.word;
    const lower = raw.toLowerCase();

    if (sourceIsEnglish) {
      if (STOPWORDS_EN.has(lower)) continue;
      if (lower === "not") { negated = true; ruleIds.add("negation"); continue; }
      if (EN_AUX_MAP[lower]) {
        tense = EN_AUX_MAP[lower].tense;
        if (tense) ruleIds.add("tense");
        if (params.to === "language" || params.to === "bengali") {
          const be = findByEnglish(entries, "be");
          if (be && !slots.some((s) => s.kind === "verb")) slots.push({ kind: "verb", text: meaningOf(be), entry: be });
        }
        continue;
      }
      if (EN_PRONOUN_MAP[lower]) {
        const entry = findByEnglish(entries, EN_PRONOUN_MAP[lower]);
        if (entry) {
          slots.push({ kind: "subject", text: meaningOf(entry), entry });
          contentCount++; mappedCount++;
          continue;
        }
      }
      const entry = findByEnglish(entries, lower);
      if (!entry) {
        contentCount++;
        unmapped.push(raw);
        slots.push({ kind: "other", text: params.to === "language" ? `[${raw}]` : raw, note: "unmapped" });
        mapping.push({ source: raw, target: `[${raw}]`, meaning: "unmapped", note: "not in dictionary" });
        continue;
      }
      contentCount++; mappedCount++;
      const isVerb = entry.part_of_speech === "verb";
      const kind: Slot["kind"] = isVerb ? "verb" : slots.some((s) => s.kind === "subject") ? "object" : "subject";
      if (isVerb) ruleIds.add("tense");
      // Plural: token ended in s and singular matched.
      const plural = lower !== entry.english_meaning.toLowerCase() && entry.part_of_speech === "noun";
      let text = meaningOf(entry);
      if (params.to === "language" && plural && affixes.plural) {
        text = `${text}${affixes.plural}`;
        ruleIds.add("plural");
        mapping.push({ source: raw, target: text, meaning: `${entry.english_meaning} (plural) / ${entry.bengali_meaning}` });
      } else {
        mapping.push({ source: raw, target: text, meaning: `${entry.english_meaning} / ${entry.bengali_meaning}` });
      }
      if (params.to === "language" && isVerb && tense) {
        const suffix = tense === "past" ? affixes.past : affixes.future;
        if (suffix) text = `${text}${suffix}`;
        mapping[mapping.length - 1] = { source: raw, target: text, meaning: `${entry.english_meaning} (${tense} tense) / ${entry.bengali_meaning}` };
      }
      slots.push({ kind, text, entry });
    } else {
      // Bengali source
      if (STOP_BN.has(raw)) continue;
      if (raw === "না" || raw === "নয়") { negated = true; ruleIds.add("negation"); continue; }
      const entry = findByBengali(entries, raw);
      if (!entry) {
        contentCount++;
        unmapped.push(raw);
        slots.push({ kind: "other", text: params.to === "language" ? `[${raw}]` : raw, note: "unmapped" });
        mapping.push({ source: raw, target: `[${raw}]`, meaning: "unmapped", note: "not in dictionary" });
        continue;
      }
      contentCount++; mappedCount++;
      const isVerb = entry.part_of_speech === "verb";
      const kind: Slot["kind"] = isVerb ? "verb" : slots.some((s) => s.kind === "subject") ? "object" : "subject";
      mapping.push({ source: raw, target: meaningOf(entry), meaning: `${entry.english_meaning} / ${entry.bengali_meaning}` });
      slots.push({ kind, text: meaningOf(entry), entry });
    }
  }

  let ordered: Slot[];
  const targetIsSOV = params.to === "language" ? wordOrder === "SOV" : params.to === "bengali";
  if (targetIsSOV) {
    const subject = slots.find((s) => s.kind === "subject");
    const verb = slots.find((s) => s.kind === "verb");
    const objects = slots.filter((s) => s.kind === "object");
    const others = slots.filter((s) => s.kind === "other");
    ordered = [...(subject ? [subject] : []), ...objects, ...others];
    if (verb) {
      if (negated && params.to === "language" && affixes.negation) {
        ordered.push({ kind: "other", text: affixes.negation, note: "negation particle" });
      }
      ordered.push(verb);
    }
    ruleIds.add("word_order");
  } else {
    const subject = slots.find((s) => s.kind === "subject");
    const verb = slots.find((s) => s.kind === "verb");
    const rest = slots.filter((s) => s !== subject && s !== verb);
    ordered = [...(subject ? [subject] : []), ...(verb ? [verb] : []), ...rest];
  }

  if (question && params.to === "language" && affixes.question) {
    ordered.push({ kind: "other", text: affixes.question, note: "question particle" });
    ruleIds.add("questions");
  }

  const translationWords = ordered.map((s) => s.text);
  const translation = translationWords.length > 0
    ? translationWords[0].charAt(0).toUpperCase() + translationWords[0].slice(1) + (translationWords.length > 1 ? " " + translationWords.slice(1).join(" ") : "")
    : "";

  // Alternatives: other entries sharing a meaning with a mapped token.
  for (const slot of slots) {
    if (!slot.entry) continue;
    const sameMeaning = entries.filter(
      (e) => e.id !== slot.entry!.id && (e.english_meaning.toLowerCase() === slot.entry!.english_meaning.toLowerCase() && slot.entry!.english_meaning !== "")
    );
    for (const alt of sameMeaning.slice(0, 2)) {
      const altText = params.to === "language" ? alt.word : params.to === "bengali" ? alt.bengali_meaning : alt.english_meaning;
      if (altText && !alternatives.includes(altText)) alternatives.push(altText);
    }
  }

  return {
    translation,
    mapping,
    ruleReferences: ruleNamesFor(profile, [...ruleIds]),
    confidence: contentCount > 0 ? Math.round((mappedCount / contentCount) * 100) / 100 : 0,
    reviewStatus: "draft",
    alternatives,
    unmapped
  };
}

const STOP_BN = new Set(["এবং", "বা", "জন্য", "সঙ্গে", "মধ্যে", "একটি", "একটা", "হয়"]);
