import type { GenStyle, PartOfSpeech } from "../../../shared/schemas.js";

/* Deterministic RNG so a language version can be reproduced from its seed. */

export type Rng = () => number;

export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

export function chance(rng: Rng, probability: number): boolean {
  return rng() < probability;
}

export function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/* ------------------------------- phonology -------------------------------- */

export interface PhonologySpec {
  consonants: string[];
  vowels: string[];
  codas: string[];
  syllableStructures: string[];
  stressRule: string;
  forbiddenClusters: string[];
  minSyllables: number;
  maxSyllables: number;
  conventions: Array<{ symbol: string; guide: string }>;
}

const CONSONANT_SETS: Record<GenStyle, string[]> = {
  naturalistic: ["t", "k", "n", "m", "s", "l", "r", "v", "th", "sh", "d", "b", "y", "h"],
  concise: ["t", "k", "s", "n", "m", "l", "r", "v", "d"],
  formal: ["m", "n", "l", "r", "s", "th", "sh", "v", "k", "t", "d"],
  futuristic: ["k", "x", "z", "v", "sh", "zh", "th", "s", "t", "n", "r"],
  original: ["k", "v", "z", "sh", "th", "n", "r", "m", "y", "x"]
};

const VOWEL_SETS: Record<GenStyle, string[]> = {
  naturalistic: ["a", "e", "i", "o", "u", "ai", "ei"],
  concise: ["a", "e", "i", "o", "u"],
  formal: ["a", "e", "i", "o", "u", "ia"],
  futuristic: ["a", "i", "u", "ei", "au", "y"],
  original: ["a", "e", "i", "o", "u", "ai", "au"]
};

const NASALS = ["n", "m", "ng"];
const FRICATIVES: Record<GenStyle, string[]> = {
  naturalistic: ["s", "sh", "th"],
  concise: ["s"],
  formal: ["s", "th"],
  futuristic: ["s", "sh", "x", "z"],
  original: ["s", "sh", "z"]
};

export function buildPhonology(rng: Rng, style: GenStyle): PhonologySpec {
  const allConsonants = CONSONANT_SETS[style];
  const consonants = shuffled(rng, allConsonants).slice(0, Math.max(8, allConsonants.length - 2));
  const vowels = [...VOWEL_SETS[style]];
  const codas = [...NASALS.filter(() => chance(rng, 0.8)), pick(rng, FRICATIVES[style])];

  const structures = ["CV", "CV"];
  if (codas.length > 0) structures.push("CVC", "CV" + codas[0]);
  if (style === "concise") structures.push("V");
  if (style === "formal" || style === "naturalistic") structures.push("CVCC".replace("CC", codas[0] ?? "s"));

  return {
    consonants,
    vowels,
    codas,
    syllableStructures: [...new Set(structures)],
    stressRule:
      style === "concise"
        ? "Stress falls on the first syllable of a word."
        : "Stress falls on the second-to-last syllable unless the final syllable is long (ai, ei, au), which then takes the stress.",
    forbiddenClusters: ["three consonants in a row", "identical syllables repeated back-to-back"],
    minSyllables: style === "concise" ? 1 : 2,
    maxSyllables: style === "formal" ? 4 : style === "concise" ? 2 : 3,
    conventions: [
      { symbol: "a", guide: "ah, as in father" },
      { symbol: "e", guide: "eh, as in bet" },
      { symbol: "i", guide: "ee, as in see" },
      { symbol: "o", guide: "oh, as in go" },
      { symbol: "u", guide: "oo, as in moon" },
      { symbol: "ai", guide: "eye" },
      { symbol: "ei", guide: "ay, as in say" },
      { symbol: "au", guide: "ow, as in cow" },
      { symbol: "th", guide: "soft th, as in think" },
      { symbol: "sh", guide: "sh, as in ship" },
      { symbol: "ng", guide: "ng, as in sing (never a hard g)" }
    ]
  };
}

/* ------------------------------ word building ------------------------------ */

export interface GeneratedWord {
  word: string;
  syllables: string[];
}

export function generateSyllable(rng: Rng, phon: PhonologySpec): string {
  const structure = pick(rng, phon.syllableStructures);
  let syl = "";
  for (const slot of structure) {
    if (slot === "C") syl += pick(rng, phon.consonants);
    else if (slot === "V") syl += pick(rng, phon.vowels);
    else syl += slot; // a concrete coda like "CVn"
  }
  return syl;
}

export function generateWord(rng: Rng, phon: PhonologySpec, taken: Set<string>): GeneratedWord {
  for (let attempt = 0; attempt < 40; attempt++) {
    const count = phon.minSyllables + Math.floor(rng() * (phon.maxSyllables - phon.minSyllables + 1));
    const syllables: string[] = [];
    for (let i = 0; i < count; i++) {
      let syl = generateSyllable(rng, phon);
      if (syllables.length > 0 && syllables[syllables.length - 1] === syl) {
        syl = generateSyllable(rng, phon);
      }
      syllables.push(syl);
    }
    const word = syllables.join("");
    if (word.length >= 2 && word.length <= 10 && !taken.has(word)) {
      taken.add(word);
      return { word, syllables };
    }
  }
  // Deterministic fallback: number the base word.
  const base = generateSyllable(rng, phon);
  const word = `${base}${Math.floor(rng() * 90 + 10)}`;
  taken.add(word);
  return { word, syllables: [word] };
}

const VOWEL_GUIDE: Record<string, string> = {
  a: "ah", e: "eh", i: "ee", o: "oh", u: "oo", ai: "eye", ei: "ay", au: "ow", y: "i"
};

/** "vethra" → "veh-thrah"-style pronunciation guide, built from the syllables. */
export function guideFromSyllables(syllables: string[]): string {
  const parts = syllables.map((syl) => {
    let out = "";
    let i = 0;
    while (i < syl.length) {
      const two = syl.slice(i, i + 2);
      if (VOWEL_GUIDE[two]) {
        out += VOWEL_GUIDE[two];
        i += 2;
        continue;
      }
      const one = syl[i];
      if (VOWEL_GUIDE[one]) {
        out += VOWEL_GUIDE[one];
        i += 1;
        continue;
      }
      const consonantTwo = ["th", "sh", "ch", "zh", "ng", "kh"].find((c) => syl.startsWith(c, i));
      if (consonantTwo) {
        out += consonantTwo;
        i += 2;
        continue;
      }
      out += one;
      i += 1;
    }
    return out;
  });
  return parts.join("-");
}

const IPA_VOWELS: Record<string, string> = { a: "ä", e: "ɛ", i: "i", o: "o", u: "u", ai: "aɪ", ei: "eɪ", au: "aʊ", y: "i" };
const IPA_CONSONANTS: Record<string, string> = { sh: "ʃ", ch: "tʃ", th: "θ", zh: "ʒ", ng: "ŋ", x: "x", y: "j" };

export function toIpa(word: string): string {
  let out = "";
  let i = 0;
  const lower = word.toLowerCase();
  while (i < lower.length) {
    const two = lower.slice(i, i + 2);
    if (IPA_VOWELS[two]) {
      out += IPA_VOWELS[two];
      i += 2;
      continue;
    }
    if (IPA_CONSONANTS[two]) {
      out += IPA_CONSONANTS[two];
      i += 2;
      continue;
    }
    const c = lower[i];
    out += IPA_VOWELS[c] ?? IPA_CONSONANTS[c] ?? c;
    i += 1;
  }
  return `/${out}/`;
}

/* --------------------------- Bengali transliteration ----------------------- */

const BN_CONSONANTS: Record<string, string> = {
  kh: "খ", gh: "ঘ", ch: "চ", chh: "ছ", jh: "ঝ", th: "থ", dh: "ধ", ph: "ফ", bh: "ভ",
  sh: "শ", ng: "ং", k: "ক", g: "গ", c: "ক", j: "জ", t: "ত", d: "দ", n: "ন", p: "প",
  f: "ফ", b: "ব", v: "ভ", m: "ম", y: "য়", r: "র", l: "ল", s: "স", h: "হ", z: "জ", x: "ক্স"
};

const BN_VOWEL_SIGNS: Record<string, string> = {
  a: "া", e: "ে", i: "ি", o: "ো", u: "ু", ai: "ৈ", au: "ৌ"
};

const BN_INDEPENDENT_VOWELS: Record<string, string> = {
  a: "আ", e: "এ", i: "ই", o: "ও", u: "উ", ai: "ঐ", au: "ঔ"
};

/** Approximate Bengali-script rendering of a romanized word ("nerava" → "নেরাভা").
 *  Decorative by design — displayed alongside the roman name, never alone. */
export function toBengaliScript(word: string): string {
  const w = word.toLowerCase();
  let out = "";
  let i = 0;
  while (i < w.length) {
    const three = w.slice(i, i + 3);
    const two = w.slice(i, i + 2);
    const one = w.slice(i, i + 1);
    if (BN_CONSONANTS[three]) {
      out += BN_CONSONANTS[three];
      const nextTwo = w.slice(i + 3, i + 5);
      const nextOne = w.slice(i + 3, i + 4);
      if (BN_VOWEL_SIGNS[nextTwo]) {
        out += BN_VOWEL_SIGNS[nextTwo];
        i += 5;
        continue;
      }
      if (BN_VOWEL_SIGNS[nextOne]) {
        out += BN_VOWEL_SIGNS[nextOne];
        i += 4;
        continue;
      }
      out += "্";
      i += 3;
      continue;
    }
    if (BN_CONSONANTS[two]) {
      out += BN_CONSONANTS[two];
      const nextTwo = w.slice(i + 2, i + 4);
      const nextOne = w.slice(i + 2, i + 3);
      if (BN_VOWEL_SIGNS[nextTwo]) {
        out += BN_VOWEL_SIGNS[nextTwo];
        i += 4;
        continue;
      }
      if (BN_VOWEL_SIGNS[nextOne]) {
        out += BN_VOWEL_SIGNS[nextOne];
        i += 3;
        continue;
      }
      out += "্";
      i += 2;
      continue;
    }
    if (BN_CONSONANTS[one]) {
      out += BN_CONSONANTS[one];
      const nextOne = w.slice(i + 1, i + 2);
      if (BN_VOWEL_SIGNS[nextOne]) {
        out += BN_VOWEL_SIGNS[nextOne];
        i += 2;
        continue;
      }
      out += "্";
      i += 1;
      continue;
    }
    if (BN_VOWEL_SIGNS[one]) {
      out += out.length === 0 ? (BN_INDEPENDENT_VOWELS[one] ?? one) : BN_VOWEL_SIGNS[one];
      i += 1;
      continue;
    }
    out += one;
    i += 1;
  }
  return out.replace(/্$/, "");
}

/* ------------------------------- name generation ---------------------------- */

const RESERVED_NAMES = new Set(["lexora", "sorevya", "english", "bengali", "bangla"]);

export interface NameCandidate {
  name: string;
  nativeName: string;
  syllables: string[];
}

export function generateNameCandidate(rng: Rng, phon: PhonologySpec, taken: Set<string>): NameCandidate | null {
  for (let attempt = 0; attempt < 40; attempt++) {
    const count = 2 + (chance(rng, 0.35) ? 1 : 0);
    const syllables: string[] = [];
    for (let i = 0; i < count; i++) {
      let syl = generateSyllable(rng, phon);
      if (i > 0 && syllables[i - 1] === syl) syl = generateSyllable(rng, phon);
      syllables.push(syl);
    }
    const name = syllables.join("");
    const normalized = name.toLowerCase();
    if (normalized.length < 4 || normalized.length > 12) continue;
    if (RESERVED_NAMES.has(normalized)) continue;
    if (taken.has(normalized)) continue;
    taken.add(normalized);
    return { name: capitalize(name), nativeName: toBengaliScript(name), syllables };
  }
  return null;
}

export function capitalize(word: string): string {
  return word.length === 0 ? word : word[0].toUpperCase() + word.slice(1);
}

export function posLabel(pos: PartOfSpeech | string): string {
  return capitalize(pos);
}
