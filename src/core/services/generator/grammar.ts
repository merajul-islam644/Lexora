import type { Rng } from "./core.js";
import { pick } from "./core.js";
import type { GrammarRule } from "../../../shared/schemas.js";

/* ------------------------------ affix inventory ---------------------------- */

export interface AffixSet {
  plural: string;
  past: string;
  future: string;
  negation: string;
  question: string;
  genitive: string;
  formal: string;
  derivations: {
    prefixes: Array<{ affix: string; meaning: string }>;
    suffixes: Array<{ affix: string; meaning: string }>;
  };
}

export function buildAffixes(rng: Rng): AffixSet {
  const plural = pick(rng, ["den", "koy", "isa", "eth"]);
  const past = pick(rng, ["ir", "enel", "tas"]);
  const future = pick(rng, ["os", "uma", "shan"]);
  const negation = pick(rng, ["vel", "mur", "zos"]);
  const question = pick(rng, ["ki", "va", "toh"]);
  const genitive = pick(rng, ["es", "ul", "ar"]);
  const formal = pick(rng, ["sev", "hon", "mir"]);
  const nounS = pick(rng, ["um", "eth", "ora"]);
  const verbS = pick(rng, ["asi", "ulo", "em"]);
  const adjS = pick(rng, ["al", "ik", "os"]);
  const advS = pick(rng, ["ali", "ikai", "osu"]);

  return {
    plural,
    past,
    future,
    negation,
    question,
    genitive,
    formal,
    derivations: {
      prefixes: [
        { affix: "sen-", meaning: "a person professionally related to (sen + trade = merchant)" },
        { affix: "kor-", meaning: "to cause or make (verb-forming prefix)" }
      ],
      suffixes: [
        { affix: `-${nounS}`, meaning: "turns a concept into a noun (thing / result)" },
        { affix: `-${verbS}`, meaning: "turns a concept into a verb (to do X)" },
        { affix: `-${adjS}`, meaning: "turns a concept into an adjective (having the quality of)" },
        { affix: `-${advS}`, meaning: "turns a word into an adverb (in X manner)" },
        { affix: `-${plural}`, meaning: "plural marker for nouns" },
        { affix: `-${genitive}`, meaning: "marks the possessor (genitive)" }
      ]
    }
  };
}

/* -------------------------------- sentence engine -------------------------- */

export interface SentenceToken {
  word: string;
  meaning: string;
  bn: string;
  pos: string;
}

export interface SentenceOptions {
  subject: SentenceToken;
  verb?: SentenceToken;
  object?: SentenceToken;
  adjective?: SentenceToken;
  adverbial?: SentenceToken;
  tense?: "present" | "past" | "future";
  pluralObject?: boolean;
  negated?: boolean;
  question?: boolean;
  formal?: boolean;
  wordOrder: "SOV" | "SVO";
  affixes: AffixSet;
}

export interface ConstructedSentence {
  constructed: string;
  tokens: Array<{ word: string; meaning: string }>;
  ruleIds: string[];
}

export function constructSentence(opts: SentenceOptions): ConstructedSentence {
  const { affixes, wordOrder } = opts;
  const ruleIds = ["word_order"];
  const verb = opts.verb;
  const object = opts.object;

  let verbForm = verb ? verb.word : "";
  if (verb && opts.tense === "past") {
    verbForm = `${verb.word}${affixes.past}`;
    ruleIds.push("tense");
  }
  if (verb && opts.tense === "future") {
    verbForm = `${verb.word}${affixes.future}`;
    ruleIds.push("tense");
  }

  let objectForm = object ? object.word : "";
  if (object && opts.pluralObject) {
    objectForm = `${object.word}${affixes.plural}`;
    ruleIds.push("plural");
  }

  const out: Array<{ text: string; meaning?: string }> = [];
  const pushToken = (text: string, meaning?: string): void => {
    if (text) out.push({ text, meaning });
  };

  if (wordOrder === "SOV") {
    pushToken(opts.subject.word, opts.subject.meaning);
    if (opts.adjective && object) {
      pushToken(opts.adjective.word, opts.adjective.meaning);
      pushToken(objectForm, object.meaning);
      ruleIds.push("adjective_order");
    } else if (object) {
      pushToken(objectForm, object.meaning);
    }
    if (opts.adverbial) {
      pushToken(opts.adverbial.word, opts.adverbial.meaning);
      ruleIds.push("time_words");
    }
    if (opts.adjective && !object && verb) {
      // predicative adjective directly before the verb
      pushToken(opts.adjective.word, opts.adjective.meaning);
      ruleIds.push("adjective_order");
    }
    if (opts.negated && verbForm) {
      pushToken(affixes.negation, "not (negation particle)");
      ruleIds.push("negation");
    }
    pushToken(verbForm, verb?.meaning);
  } else {
    pushToken(opts.subject.word, opts.subject.meaning);
    if (opts.negated && verbForm) {
      pushToken(affixes.negation, "not (negation particle)");
      ruleIds.push("negation");
    }
    pushToken(verbForm, verb?.meaning);
    if (opts.adjective && !object) pushToken(opts.adjective.word, opts.adjective.meaning);
    if (opts.adjective && object) {
      pushToken(opts.adjective.word, opts.adjective.meaning);
      ruleIds.push("adjective_order");
    }
    pushToken(objectForm, object?.meaning);
    if (opts.adverbial) {
      pushToken(opts.adverbial.word, opts.adverbial.meaning);
      ruleIds.push("time_words");
    }
  }

  if (opts.formal) {
    pushToken(affixes.formal, "formal/polite marker");
    ruleIds.push("register");
  }
  if (opts.question) {
    pushToken(affixes.question, "question particle");
    ruleIds.push("questions");
  }

  const words = out.map((t) => t.text);
  const constructed = words.length > 0 ? words[0].charAt(0).toUpperCase() + words[0].slice(1) + (words.length > 1 ? " " + words.slice(1).join(" ") : "") : "";
  return {
    constructed,
    tokens: out.filter((t) => t.meaning !== undefined || t.text).map((t) => ({ word: t.text, meaning: t.meaning ?? t.text })),
    ruleIds
  };
}

/* ------------------------------- grammar rules ------------------------------ */

export interface RuleSamples {
  noun: { word: string; bn: string; en: string };
  verb: { word: string; bn: string; en: string };
}

export function buildGrammarRules(
  wordOrder: "SOV" | "SVO",
  affixes: AffixSet,
  samples: RuleSamples,
  version: number
): GrammarRule[] {
  const s = samples;
  const rules: GrammarRule[] = [];
  const rule = (
    id: string, name: string, category: string,
    explanationEnglish: string, explanationBengali: string,
    pattern: string,
    validExamples: string[],
    invalidExamples: Array<{ example: string; why: string }>
  ): void => {
    rules.push({ id, name, category, explanationEnglish, explanationBengali, pattern, validExamples, invalidExamples, introducedInVersion: version });
  };

  const orderText =
    wordOrder === "SOV"
      ? "Subject – Object – Verb (the verb comes last, like Bengali)."
      : "Subject – Verb – Object (the verb comes second, like English).";
  const orderBn =
    wordOrder === "SOV"
      ? "কর্তা – কর্ম – ক্রিয়া (ক্রিয়া সবশেষে আসে, বাংলার মতো)।"
      : "কর্তা – ক্রিয়া – কর্ম (ক্রিয়া দ্বিতীয় স্থানে আসে, ইংরেজির মতো)।";
  const valid1 =
    wordOrder === "SOV"
      ? `${capitalize(s.noun.word)} ${s.verb.word}.`
      : `${capitalize(s.noun.word)} ${s.verb.word}.`;
  const invalid1 =
    wordOrder === "SOV"
      ? `${capitalize(s.verb.word)} ${s.noun.word}. — the verb must come last in a statement.`
      : `${capitalize(s.noun.word)} ${s.verb.word} ${s.noun.word}. — two objects without a connector is ungrammatical.`;

  rule(
    "word_order", "Basic word order", "Syntax",
    `A simple statement follows ${orderText}`,
    `একটি সাধারণ বাক্য এই ক্রম মেনে চলে: ${orderBn}`,
    wordOrder === "SOV" ? "SUBJECT OBJECT VERB" : "SUBJECT VERB OBJECT",
    [valid1],
    [{ example: invalid1, why: wordOrder === "SOV" ? "Verb appears before its object." : "Word order duplicated." }]
  );

  rule(
    "plural", "Plural nouns", "Nouns",
    `Add the suffix -${affixes.plural} to a noun to make it plural. The suffix never changes with case.`,
    `বিশেষ্যকে বহুবচন করতে শব্দের শেষে -${affixes.plural} যোগ করা হয়। এই প্রত্যয় কখনও পরিবর্তিত হয় না।`,
    `NOUN + -${affixes.plural}`,
    [`${s.noun.word}${affixes.plural} — "${s.noun.en}s" / "${s.noun.bn}" (plural)`],
    [{ example: `${affixes.plural}${s.noun.word}`, why: "The plural suffix must follow the noun, not precede it." }]
  );

  rule(
    "pronouns", "Personal pronouns", "Pronouns",
    "Pronouns do not change form for gender. The same set is used for formal and informal address; politeness is carried by the formal particle instead.",
    "সর্বনাম লিঙ্গভেদে পরিবর্তিত হয় না। আদর বা সম্মান আলাদা কণা দিয়ে বোঝানো হয়, সর্বনাম বদলে নয়।",
    "sha (I/আমি), tavi (you/তুমি), shanu (we/আমরা), relun (they/তারা)",
    ["Sha vethir. — I spoke. / আমি বলেছি।"],
    []
  );

  rule(
    "tense", "Verb tense", "Verbs",
    `Verbs are unmarked in the present. The past takes -${affixes.past} and the future takes -${affixes.future}, attached directly to the verb stem.`,
    `ক্রিয়ার বর্তমান কালে কোনো চিহ্ন থাকে না। অতীত কালে -${affixes.past} এবং ভবিষ্যৎ কালে -${affixes.future} যোগ হয়।`,
    `VERB (present) | VERB + -${affixes.past} (past) | VERB + -${affixes.future} (future)`,
    [
      `${s.verb.word} — "${s.verb.en}" (present)`,
      `${s.verb.word}${affixes.past} — "${s.verb.en}" (past)`,
      `${s.verb.word}${affixes.future} — "${s.verb.en}" (future)`
    ],
    [{ example: `${affixes.past} ${s.verb.word}`, why: "Tense suffixes attach to the verb; they are not separate words." }]
  );

  rule(
    "negation", "Negation", "Negation",
    `Place the particle ${affixes.negation} immediately before the verb to negate a sentence.`,
    `বাক্য অস্বীকার করতে ক্রিয়ার ঠিক আগে ${affixes.negation} কণাটি বসে।`,
    `SUBJECT ... ${affixes.negation} VERB`,
    [
      wordOrder === "SOV"
        ? `${capitalize(s.noun.word)} ${affixes.negation} ${s.verb.word}. — "${s.noun.en} does not ${s.verb.en}."`
        : `${capitalize(s.noun.word)} ${affixes.negation} ${s.verb.word}. — "${s.noun.en} does not ${s.verb.en}."`
    ],
    [{ example: `${capitalize(s.noun.word)} ${s.verb.word} ${affixes.negation}.`, why: "The negation particle comes before the verb, never after it." }]
  );

  rule(
    "questions", "Questions", "Questions",
    `Add the question particle ${affixes.question} at the very end of the sentence. Word order does not change in questions.`,
    `প্রশ্ন করতে বাক্যের একদম শেষে ${affixes.question} কণাটি যোগ হয়। প্রশ্নে শব্দের ক্রম বদলায় না।`,
    "STATEMENT + " + affixes.question,
    [`${capitalize(s.noun.word)} ${s.verb.word}${affixes.question}? — "Does the ${s.noun.en} ${s.verb.en}?"`],
    [{ example: `${affixes.question} ${capitalize(s.noun.word)} ${s.verb.word}?`, why: "The question particle closes the sentence; it does not open it." }]
  );

  rule(
    "adjective_order", "Adjectives", "Adjectives and adverbs",
    "An adjective always comes directly before the noun it describes. Adjectives do not agree with the noun in number or case.",
    "বিশেষণ সর্বদা তার বিশেষ্যের ঠিক আগে বসে। বিশেষণ বচন বা কারকের সাথে মিলে পরিবর্তিত হয় না।",
    "ADJECTIVE NOUN",
    [`${capitalize(s.noun.word)} ${s.verb.word}. — adjective ${s.noun.word} directly precedes its noun in longer phrases.`],
    [{ example: `${capitalize(s.noun.word)} ${s.verb.word} ${s.noun.word}-adjective.`, why: "Adjectives follow their noun in this example, which is not allowed." }]
  );

  rule(
    "possession", "Possession", "Possession",
    `The possessor takes the suffix -${affixes.genitive} and comes before the possessed noun.`,
    `যার মালিকানা, সেই শব্দের শেষে -${affixes.genitive} যোগ হয় এবং সেটি মালিকানাধীন বিশেষ্যের আগে বসে।`,
    `POSSESSOR + -${affixes.genitive} + POSSESSED`,
    [`${s.noun.word}${affixes.genitive} ${s.verb.word.slice(0, 3)} — "${the(s.noun.en)}'s ..." pattern`],
    [{ example: `${s.verb.word} ${s.noun.word}${affixes.genitive}`, why: "The possessor must precede the thing possessed." }]
  );

  rule(
    "postpositions", "Postpositions", "Prepositions and postpositions",
    "Spatial and time relations use postpositions: the relation word follows the noun, as in Bengali.",
    "অবস্থান বা সময় বোঝাতে অনুসর্গ ব্যবহৃত হয়: বিশেষণটির পরে সম্পর্কসূচক শব্দটি আসে, বাংলার মতো।",
    "NOUN + POSTPOSITION",
    [`${s.noun.word} kel — "at the ${s.noun.en}" (kel = at)`],
    [{ example: `kel ${s.noun.word}`, why: "Postpositions follow the noun; they never precede it." }]
  );

  rule(
    "word_formation", "Deriving new words", "Word formation",
    `New words are built from roots with the affixes: ${affixes.derivations.prefixes.map((p) => p.affix).join(", ")} as prefixes and ${affixes.derivations.suffixes.map((x) => x.affix).join(", ")} as suffixes. Related concepts keep the same root.`,
    `মূল শব্দ (root) থেকে এই প্রত্যয়গুলো দিয়ে নতুন শব্দ তৈরি হয়: ${affixes.derivations.suffixes.map((x) => x.affix).join(", ")}। সম্পর্কিত ধারণাগুলো একই root ভাগ করে নেয়।`,
    "ROOT + DERIVATIONAL SUFFIX",
    affixes.derivations.suffixes.slice(0, 3).map((x) => `${s.verb.word.slice(0, 3)}${x.affix.replace("-", "")} — root + ${x.affix} (${x.meaning})`),
    []
  );

  rule(
    "register", "Formal register", "Registers",
    `Add the particle ${affixes.formal} after the verb to make a request or statement formal/polite. Business letters should use it with new contacts.`,
    `অনুরোধ বা বক্তব্যকে ভদ্র/আনুষ্ঠানিক করতে ক্রিয়ার পরে ${affixes.formal} কণাটি যোগ করা হয়। নতুন ব্যবসায়িক যোগাযোগে এটি ব্যবহার করা উচিত।`,
    "VERB + " + affixes.formal,
    [`${capitalize(s.verb.word)}${affixes.formal}. — a polite "${s.verb.en}, please."`],
    []
  );

  return rules;
}

function the(noun: string): string {
  return `the ${noun}`;
}

function capitalize(word: string): string {
  return word.length === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1);
}
