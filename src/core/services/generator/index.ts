import {
  type Rng, mulberry32, hashSeed, pick, chance,
  buildPhonology, generateWord, guideFromSyllables, toIpa, toBengaliScript,
  generateNameCandidate, capitalize, type PhonologySpec, type NameCandidate
} from "./core.js";
import { buildAffixes, buildGrammarRules, constructSentence, type AffixSet, type SentenceToken } from "./grammar.js";
import { HttpError } from "../../lib/http.js";
import { normalizeWord } from "../../db/ids.js";
import type { EntryRow } from "../../db/rows.js";
import {
  languageProfileSchema,
  type GenStyle,
  type LanguageProfile,
  type ReferenceLangs,
  type VocabularyItem,
  type GrammarRule,
  type ExampleSentence,
  type PartOfSpeech
} from "../../../shared/schemas.js";

export const GENERATION_STAGES = [
  { id: "reviewing_dictionary", label: "Reviewing dictionary", labelBn: "অভিধান পর্যালোচনা চলছে" },
  { id: "sound_rules", label: "Creating sound and spelling rules", labelBn: "ধ্বনি ও বানানের নিয়ম তৈরি হচ্ছে" },
  { id: "vocabulary", label: "Building vocabulary mappings", labelBn: "শব্দভাণ্ডারের ম্যাপিং তৈরি হচ্ছে" },
  { id: "grammar", label: "Designing grammar", labelBn: "ব্যাকরণ ডিজাইন করা হচ্ছে" },
  { id: "consistency", label: "Checking consistency", labelBn: "সামঞ্জস্য পরীক্ষা চলছে" },
  { id: "saving", label: "Saving language version", labelBn: "ভাষার সংস্করণ সংরক্ষণ করা হচ্ছে" }
] as const;

export type StageId = (typeof GENERATION_STAGES)[number]["id"];

export interface GenerationInput {
  workspaceName: string;
  entries: EntryRow[];
  style: GenStyle;
  referenceLangs: ReferenceLangs;
  existingNames: ReadonlySet<string>;
  existingWords: ReadonlySet<string>;
  preferredName?: string;
  seed: number;
  version: number;
}

interface EngineContext {
  input: GenerationInput;
  rng: Rng;
  phon: PhonologySpec;
  affixes: AffixSet;
  takenWords: Set<string>;
  vocab: VocabularyItem[];
  derivedWords: string[];
  warnings: string[];
  usable: EntryRow[];
  wordOrder: "SOV" | "SVO";
  nameCandidates: NameCandidate[];
  chosen: NameCandidate | null;
  rules: GrammarRule[];
  sentences: ExampleSentence[];
  version: number;
}

/* --------------------------- core vocabulary seeds -------------------------- */
/* Function words and generic concepts the language itself defines. These are
 * clearly marked source:"generated" — never mixed with user-provided entries. */

const CORE_WORDS: Array<{ bn: string; en: string; pos: PartOfSpeech }> = [
  { bn: "আমি", en: "I", pos: "pronoun" },
  { bn: "তুমি", en: "you", pos: "pronoun" },
  { bn: "আমরা", en: "we", pos: "pronoun" },
  { bn: "তারা", en: "they", pos: "pronoun" },
  { bn: "হ্যাঁ", en: "yes", pos: "interjection" },
  { bn: "না", en: "no", pos: "interjection" },
  { bn: "এবং", en: "and", pos: "conjunction" },
  { bn: "হওয়া", en: "be", pos: "verb" },
  { bn: "করা", en: "make", pos: "verb" },
  { bn: "দেওয়া", en: "give", pos: "verb" },
  { bn: "দেখা", en: "see", pos: "verb" },
  { bn: "আসা", en: "come", pos: "verb" },
  { bn: "দরকার", en: "need", pos: "verb" },
  { bn: "জিনিস", en: "thing", pos: "noun" },
  { bn: "সময়", en: "time", pos: "noun" },
  { bn: "জায়গা", en: "place", pos: "noun" },
  { bn: "মানুষ", en: "people", pos: "noun" },
  { bn: "শব্দ", en: "word", pos: "noun" },
  { bn: "ভাষা", en: "language", pos: "noun" },
  { bn: "কাজ", en: "work", pos: "noun" },
  { bn: "দিন", en: "day", pos: "noun" },
  { bn: "দলিল", en: "document", pos: "noun" },
  { bn: "আগামীকাল", en: "tomorrow", pos: "adverb" },
  { bn: "এখন", en: "now", pos: "adverb" },
  { bn: "ভালো", en: "good", pos: "adjective" },
  { bn: "প্রস্তুত", en: "ready", pos: "adjective" },
  { bn: "সম্পূর্ণ", en: "complete", pos: "adjective" }
];

/* ------------------------------- the engine --------------------------------- */

export class GenerationEngine {
  private ctx: EngineContext;

  constructor(input: GenerationInput) {
    this.ctx = {
      input,
      rng: mulberry32(input.seed),
      phon: buildPhonology(mulberry32(input.seed ^ 0x9e3779b9), input.style),
      affixes: buildAffixes(mulberry32((input.seed ^ 0x51ed270b) >>> 0)),
      takenWords: new Set<string>(),
      vocab: [],
      derivedWords: [],
      warnings: [],
      usable: input.entries.filter((e) => !e.archived),
      wordOrder: "SOV",
      nameCandidates: [],
      chosen: null,
      rules: [],
      sentences: [],
      version: input.version
    };
    // Words already in the dictionary can never be reused by the generator.
    for (const word of input.existingWords) this.ctx.takenWords.add(word);
  }

  reviewingDictionary(): void {
    const { usable, input } = this.ctx;
    if (usable.length === 0) {
      throw new HttpError(
        400,
        "Your dictionary is empty, so there is nothing to generate a language from yet. Add or import words first, or start with the starter dictionary.",
        "dictionary_empty"
      );
    }
    const noReference = usable.filter((e) => !e.bengali_meaning && !e.english_meaning).length;
    if (noReference > 0) {
      this.ctx.warnings.push(`${noReference} dictionary entries have neither a Bengali nor an English reference meaning; they were still mapped by word form.`);
    }
    const pref = input.preferredName?.toLowerCase().trim();
    if (pref && this.ctx.input.existingNames.has(pref)) {
      this.ctx.warnings.push(`Preferred name "${input.preferredName}" is already taken; a unique name was generated instead.`);
    }
  }

  soundRules(): void {
    const ctx = this.ctx;
    // Candidate language names, kept until the save stage picks a free one.
    const takenNames = new Set(ctx.input.existingNames);
    const preferred = ctx.input.preferredName?.trim().toLowerCase();
    if (preferred && !ctx.input.existingNames.has(preferred)) {
      ctx.chosen = {
        name: capitalize(ctx.input.preferredName!.trim()),
        nativeName: toBengaliScript(ctx.input.preferredName!.trim()),
        syllables: [ctx.input.preferredName!.trim()]
      };
    }
    for (let i = 0; i < 30 && !ctx.chosen; i++) {
      const candidate = generateNameCandidate(this.ctx.rng, this.ctx.phon, takenNames);
      if (candidate) {
        ctx.nameCandidates.push(candidate);
        if (candidate.name.length >= 4) ctx.chosen = candidate;
      }
    }
  }

  vocabulary(): void {
    const ctx = this.ctx;
    const style = ctx.input.style;

    // Root reuse: related meanings share a root and take different suffixes.
    const rootsByPos = new Map<PartOfSpeech, { root: string; bn: string; en: string }>();

    for (const entry of ctx.usable) {
      const pos = (entry.part_of_speech as PartOfSpeech) || "noun";
      if (entry.word && entry.word.trim()) {
        // User already supplied a constructed word — preserve it untouched.
        const word = entry.word.trim();
        ctx.vocab.push({
          entryId: entry.id,
          source: entry.source === "imported" ? "imported" : "user",
          word,
          bengaliMeaning: entry.bengali_meaning,
          englishMeaning: entry.english_meaning,
          partOfSpeech: pos,
          pronunciationGuide: entry.pronunciation_guide || guideFromSyllables([word]),
          root: entry.root || "",
          formation: entry.word_formation_explanation || ""
        });
        continue;
      }

      // Generate a word for this concept.
      let word: string;
      let formation = "";
      let root = "";
      const existing = rootsByPos.get(pos);
      if (existing && chance(ctx.rng, 0.5) && style !== "original") {
        root = existing.root;
        const suffix = derivationSuffix(ctx.affixes, pos);
        word = existing.root + suffix;
        if (ctx.takenWords.has(word) || looksInvalid(word, ctx.phon)) {
          const fresh = generateWord(ctx.rng, ctx.phon, ctx.takenWords);
          word = fresh.word;
          root = fresh.word;
          formation = `fresh root "${root}" for "${entry.english_meaning || entry.bengali_meaning}"`;
        } else {
          formation = `root "${root}" (“${existing.en}” / “${existing.bn}”) + ${pos} suffix -${suffix}`;
        }
      } else {
        const fresh = generateWord(ctx.rng, ctx.phon, ctx.takenWords);
        word = fresh.word;
        root = fresh.word;
        formation = `fresh root "${root}"`;
      }
      if (!rootsByPos.has(pos)) {
        rootsByPos.set(pos, { root, bn: entry.bengali_meaning, en: entry.english_meaning });
      }
      ctx.vocab.push({
        entryId: entry.id,
        source: "user",
        word,
        bengaliMeaning: entry.bengali_meaning,
        englishMeaning: entry.english_meaning,
        partOfSpeech: pos,
        pronunciationGuide: guideFromSyllables(syllableSplit(word, ctx.phon)),
        root,
        formation
      });
    }

    // Core function words, all clearly marked as generated.
    for (const core of CORE_WORDS) {
      const fresh = generateWord(ctx.rng, ctx.phon, ctx.takenWords);
      const word = fresh.word;
      ctx.derivedWords.push(word);
      ctx.vocab.push({
        entryId: null,
        source: "generated",
        word,
        bengaliMeaning: core.bn,
        englishMeaning: core.en,
        partOfSpeech: core.pos,
        pronunciationGuide: guideFromSyllables(fresh.syllables),
        root: word,
        formation: `core ${core.pos} of the language`
      });
    }
  }

  grammar(): void {
    const ctx = this.ctx;
    ctx.wordOrder = ctx.input.style === "original" && chance(ctx.rng, 0.3) ? "SVO" : "SOV";

    const findToken = (en: string): SentenceToken | null => {
      const hit = ctx.vocab.find((v) => v.englishMeaning.toLowerCase() === en);
      return hit ? { word: hit.word, meaning: hit.englishMeaning, bn: hit.bengaliMeaning, pos: hit.partOfSpeech } : null;
    };

    const noun = ctx.vocab.find((v) => v.partOfSpeech === "noun" && v.source === "user");
    const verb = ctx.vocab.find((v) => v.partOfSpeech === "verb" && v.source === "user");
    const samples = {
      noun: {
        word: noun?.word ?? findToken("thing")!.word,
        bn: noun?.bengaliMeaning ?? "জিনিস",
        en: noun?.englishMeaning ?? "thing"
      },
      verb: {
        word: verb?.word ?? findToken("make")!.word,
        bn: verb?.bengaliMeaning ?? "করা",
        en: verb?.englishMeaning ?? "make"
      }
    };

    ctx.rules = buildGrammarRules(ctx.wordOrder, ctx.affixes, samples, ctx.version);
    ctx.sentences = buildExampleSentences(ctx);
  }

  consistency(): void {
    const ctx = this.ctx;
    const seen = new Map<string, number>();

    // 1. duplicate words inside the generated vocabulary
    for (const item of ctx.vocab) {
      const norm = normalizeWord(item.word);
      const count = seen.get(norm) ?? 0;
      seen.set(norm, count + 1);
    }
    for (const [norm, count] of seen) {
      if (count > 1) {
        ctx.warnings.push(`The form "${norm}" appears ${count} times in the vocabulary and was flagged for review.`);
      }
    }

    // 2. words that ignore the sound inventory
    const allowed = new Set<string>([...ctx.phon.consonants, ...ctx.phon.vowels]);
    for (const item of ctx.vocab) {
      const chunks = splitChunks(item.word.toLowerCase());
      const foreign = chunks.filter((c) => !allowed.has(c));
      if (foreign.length > 0) {
        ctx.warnings.push(`"${item.word}" uses sound(s) ${foreign.join(", ")} outside the language inventory — kept as provided, consider revising.`);
      }
    }

    // 3. grammar sanity: exactly one word order rule, examples reference known words
    const orderRules = ctx.rules.filter((r) => r.category === "Syntax");
    if (orderRules.length !== 1) {
      ctx.warnings.push("Word-order rules could not be uniquely determined; review the syntax section.");
    }

    // 4. ensure example sentences only use known vocabulary or affixes
    const known = new Set(ctx.vocab.map((v) => v.word));
    for (const sentence of ctx.sentences) {
      const unknown = sentence.gloss.map((g) => g.token).filter((t) => !known.has(t) && !isAffixToken(t, ctx.affixes));
      if (unknown.length > 0) {
        ctx.warnings.push(`Example sentence "${sentence.constructed}" contains unmapped forms: ${unknown.join(", ")}.`);
      }
    }

    // Rule examples in grammar reference real words — nothing further to check here.
    if (ctx.warnings.length === 0) {
      ctx.warnings.push("No consistency problems found.");
    }
  }

  buildProfile(): LanguageProfile {
    const ctx = this.ctx;
    if (!ctx.chosen) throw new HttpError(500, "Language name generation failed", "name_failed");
    const chosen = ctx.chosen;
    const words = ctx.vocab.length;
    const description = `A ${ctx.input.style} constructed language generated for ${ctx.input.workspaceName} from ${ctx.usable.length} dictionary concept${ctx.usable.length === 1 ? "" : "s"}, with Bengali and English references preserved.`.slice(0, 400);

    const profile = {
      name: chosen.name,
      nativeName: chosen.nativeName,
      description,
      writingSystem: {
        type: "Latin alphabet (romanized)",
        description: `Written left-to-right in the Latin alphabet using these letters: ${[...ctx.phon.consonants, ...ctx.phon.vowels].join(", ")}. Digraphs (th, sh, ng) count as single letters. A display form in Bengali script is provided as a transliteration.`,
        alphabet: [...ctx.phon.consonants, ...ctx.phon.vowels],
        numerals: "Western Arabic numerals (0–9) are used in writing; each numeral also has a spoken word form.",
        capitalization: "Only the first word of a sentence and proper names are capitalized."
      },
      phonology: {
        consonants: ctx.phon.consonants,
        vowels: ctx.phon.vowels,
        syllableStructures: ctx.phon.syllableStructures,
        stressRule: ctx.phon.stressRule,
        forbiddenClusters: ctx.phon.forbiddenClusters,
        pronunciationConventions: ctx.phon.conventions
      },
      wordOrder: ctx.wordOrder,
      affixes: {
        plural: ctx.affixes.plural,
        past: ctx.affixes.past,
        future: ctx.affixes.future,
        negation: ctx.affixes.negation,
        question: ctx.affixes.question,
        genitive: ctx.affixes.genitive,
        formal: ctx.affixes.formal
      },
      wordFormation: ctx.affixes.derivations,
      grammarRules: ctx.rules,
      vocabulary: ctx.vocab,
      derivedWords: ctx.derivedWords,
      exampleSentences: ctx.sentences,
      consistencyWarnings: ctx.warnings,
      versionSummary: `Version ${ctx.version} (${ctx.input.style} style): ${words} words, ${ctx.rules.length} grammar rules, ${ctx.sentences.length} example sentences. Seed ${ctx.input.seed}.`,
      style: ctx.input.style,
      seed: ctx.input.seed
    };

    // Schema validation is part of the contract (spec §16): nothing invalid leaves the engine.
    const parsed = languageProfileSchema.safeParse(profile);
    if (!parsed.success) {
      throw new HttpError(500, "Generated language failed validation and was not saved", "generation_invalid", {
        issues: parsed.error.issues.slice(0, 10)
      });
    }
    return parsed.data;
  }

  runStage(stageId: Exclude<StageId, "saving">): void {
    switch (stageId) {
      case "reviewing_dictionary": return this.reviewingDictionary();
      case "sound_rules": return this.soundRules();
      case "vocabulary": return this.vocabulary();
      case "grammar": return this.grammar();
      case "consistency": return this.consistency();
    }
  }

  get context(): Readonly<EngineContext> {
    return this.ctx;
  }
}

export function validateProfileOrThrow(raw: unknown): LanguageProfile {
  const parsed = languageProfileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(502, "The generation provider returned an invalid language; nothing was saved", "generation_invalid", {
      issues: parsed.error.issues.slice(0, 10)
    });
  }
  return parsed.data;
}

/* --------------------------------- helpers --------------------------------- */

function derivationSuffix(affixes: AffixSet, pos: PartOfSpeech): string {
  const bare = (a: string): string => a.replace(/^-/, "");
  switch (pos) {
    case "verb": return bare(affixes.derivations.suffixes[1]?.affix ?? "asi");
    case "adjective": return bare(affixes.derivations.suffixes[2]?.affix ?? "al");
    case "adverb": return bare(affixes.derivations.suffixes[3]?.affix ?? "ali");
    default: return bare(affixes.derivations.suffixes[0]?.affix ?? "um");
  }
}

function looksInvalid(word: string, phon: PhonologySpec): boolean {
  return word.length < 2 || splitChunks(word).some((c) => ![...phon.consonants, ...phon.vowels].includes(c));
}

function splitChunks(word: string): string[] {
  const digraphs = ["ch", "sh", "th", "zh", "ng", "kh", "gh", "ai", "ei", "au", "ia"];
  const out: string[] = [];
  let i = 0;
  while (i < word.length) {
    const two = word.slice(i, i + 2);
    if (digraphs.includes(two)) {
      out.push(two);
      i += 2;
    } else {
      out.push(word[i]);
      i += 1;
    }
  }
  return out;
}

function syllableSplit(word: string, phon: PhonologySpec): string[] {
  // Best-effort syllable split for pronunciation guides.
  const vowels = new Set(phon.vowels.flatMap((v) => (v.length === 1 ? [v] : [])));
  const syllables: string[] = [];
  let current = "";
  let hadVowel = false;
  for (const ch of word) {
    current += ch;
    if (vowels.has(ch)) hadVowel = true;
    else if (hadVowel) {
      syllables.push(current);
      current = "";
      hadVowel = false;
    }
  }
  if (current) {
    if (syllables.length > 0) syllables[syllables.length - 1] += current;
    else syllables.push(current);
  }
  return syllables.length > 0 ? syllables : [word];
}

function isAffixToken(token: string, affixes: AffixSet): boolean {
  const bare = [affixes.plural, affixes.past, affixes.future, affixes.negation, affixes.question, affixes.genitive, affixes.formal];
  return bare.includes(token);
}

/* ----------------------------- example sentences ---------------------------- */

interface TemplateResult {
  english: string;
  bengali: string;
  opts: {
    subject: SentenceToken; verb?: SentenceToken; object?: SentenceToken;
    adjective?: SentenceToken; adverbial?: SentenceToken;
    tense?: "present" | "past" | "future";
    pluralObject?: boolean; negated?: boolean; question?: boolean; formal?: boolean;
  };
  ruleNotes: string[];
}

function buildExampleSentences(ctx: EngineContext): ExampleSentence[] {
  const { affixes, wordOrder } = ctx;
  const T = (en: string): SentenceToken => {
    const hit = ctx.vocab.find((v) => v.englishMeaning.toLowerCase() === en);
    if (hit) return { word: hit.word, meaning: hit.englishMeaning, bn: hit.bengaliMeaning, pos: hit.partOfSpeech };
    throw new Error(`core word missing: ${en}`);
  };
  const U = (en: string, fallback: string): SentenceToken | undefined => {
    const hit = ctx.vocab.find((v) => v.source === "user" && v.englishMeaning.toLowerCase() === en);
    if (hit) return { word: hit.word, meaning: hit.englishMeaning, bn: hit.bengaliMeaning, pos: hit.partOfSpeech };
    const fb = ctx.vocab.find((v) => v.englishMeaning.toLowerCase() === fallback);
    return fb ? { word: fb.word, meaning: fb.englishMeaning, bn: fb.bengaliMeaning, pos: fb.partOfSpeech } : undefined;
  };

  const definitions: Array<() => TemplateResult> = [
    () => ({
      english: "I confirm the agreement.",
      bengali: "আমি চুক্তিটি নিশ্চিত করি।",
      opts: { subject: T("I"), verb: U("confirm", "see")!, object: U("agreement", "document") },
      ruleNotes: ["word_order"]
    }),
    () => ({
      english: "The shipment arrives tomorrow.",
      bengali: "মালামাল আগামীকাল পৌঁছাবে।",
      opts: { subject: U("shipment", "thing")!, verb: U("arrive", "come")!, adverbial: T("tomorrow"), tense: "future" },
      ruleNotes: ["word_order", "tense", "time_words"]
    }),
    () => ({
      english: "Please approve the payment.",
      bengali: "অনুগ্রহ করে পেমেন্টটি অনুমোদন করুন।",
      opts: { subject: T("you"), verb: U("approve", "give")!, object: U("payment", "thing"), formal: true },
      ruleNotes: ["word_order", "register"]
    }),
    () => ({
      english: "The price includes the discount.",
      bengali: "মূল্যের মধ্যে ছাড়টি অন্তর্ভুক্ত।",
      opts: { subject: U("price", "thing")!, verb: U("include", "give")!, object: U("discount", "thing") },
      ruleNotes: ["word_order"]
    }),
    () => ({
      english: "We will review the contract.",
      bengali: "আমরা চুক্তিটি পর্যালোচনা করব।",
      opts: { subject: T("we"), verb: U("review", "see")!, object: U("contract", "document"), tense: "future" },
      ruleNotes: ["word_order", "tense"]
    }),
    () => ({
      english: "Is the invoice ready?",
      bengali: "ইনভয়েসটি কি প্রস্তুত?",
      opts: { subject: U("invoice", "document")!, verb: T("be"), adjective: U("ready", "ready")!, question: true },
      ruleNotes: ["word_order", "questions"]
    }),
    () => ({
      english: "The delivery is not complete.",
      bengali: "ডেলিভারিটি সম্পূর্ণ নয়।",
      opts: { subject: U("delivery", "thing")!, verb: T("be"), adjective: U("complete", "complete")!, negated: true },
      ruleNotes: ["word_order", "negation"]
    }),
    () => ({
      english: "We thank the customer.",
      bengali: "আমরা ক্রেতাকে ধন্যবাদ জানাই।",
      opts: { subject: T("we"), verb: U("thank", "give")!, object: U("customer", "people") },
      ruleNotes: ["word_order"]
    }),
    () => ({
      english: "The meeting starts now.",
      bengali: "সভাটি এখন শুরু হচ্ছে।",
      opts: { subject: U("meeting", "work")!, verb: U("start", "come")!, adverbial: T("now") },
      ruleNotes: ["word_order", "time_words"]
    }),
    () => ({
      english: "Send the reports before the deadline.",
      bengali: "সময়সীমার আগে রিপোর্টগুলো পাঠাও।",
      opts: { subject: T("you"), verb: U("send", "give")!, object: U("report", "document"), pluralObject: true },
      ruleNotes: ["word_order", "plural"]
    })
  ];

  const sentences: ExampleSentence[] = [];
  for (const def of definitions) {
    try {
      const t = def();
      const built = constructSentence({ ...t.opts, wordOrder, affixes });
      sentences.push({
        id: `ex-${sentences.length + 1}`,
        constructed: built.constructed,
        bengali: t.bengali,
        english: t.english,
        gloss: built.tokens.map((tok) => ({ token: tok.word, meaning: tok.meaning })),
        grammarNotes: t.ruleNotes
          .map((id) => ctx.rules.find((r) => r.id === id)?.name ?? id)
          .join("; "),
        reviewStatus: "draft"
      });
    } catch {
      // A template whose fallback words are missing is skipped — never fabricated.
    }
  }
  return sentences;
}
