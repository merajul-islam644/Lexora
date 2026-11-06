import { uid, nowIso, normalizeWord } from "../db/ids.js";
import type { DataStore } from "../db/store.js";
import type { PartOfSpeech } from "../../shared/schemas.js";

/* Starter dictionary: one click fills an empty workspace with ~40 business
 * entries so generation has raw material (design.md §3, §8: "Start with a
 * starter dictionary"). The suggested word forms are proposals -- users edit
 * or replace them; generation preserves them as user-provided words and maps
 * every concept the engine's sentence templates reference, so example
 * sentences come out in the user's own vocabulary. */

export interface StarterWord {
  word: string;
  bengaliMeaning: string;
  englishMeaning: string;
  partOfSpeech: PartOfSpeech;
  pronunciationGuide: string;
}

export const STARTER_DICTIONARY: StarterWord[] = [
  // The concepts the engine's example-sentence templates look up first.
  { word: "vethra", bengaliMeaning: "চুক্তি", englishMeaning: "agreement", partOfSpeech: "noun", pronunciationGuide: "VETH-ra" },
  { word: "seniko", bengaliMeaning: "নিশ্চিত করা", englishMeaning: "confirm", partOfSpeech: "verb", pronunciationGuide: "SE-ni-ko" },
  { word: "malvun", bengaliMeaning: "মালামাল", englishMeaning: "shipment", partOfSpeech: "noun", pronunciationGuide: "MAL-vun" },
  { word: "auroven", bengaliMeaning: "পৌঁছানো", englishMeaning: "arrive", partOfSpeech: "verb", pronunciationGuide: "AU-ro-ven" },
  { word: "kairum", bengaliMeaning: "অনুমোদন", englishMeaning: "approval", partOfSpeech: "noun", pronunciationGuide: "KAI-rum" },
  { word: "pelami", bengaliMeaning: "পেমেন্ট", englishMeaning: "payment", partOfSpeech: "noun", pronunciationGuide: "pe-LA-mi" },
  { word: "doreno", bengaliMeaning: "মূল্য", englishMeaning: "price", partOfSpeech: "noun", pronunciationGuide: "do-RE-no" },
  { word: "onthari", bengaliMeaning: "অন্তর্ভুক্ত করা", englishMeaning: "include", partOfSpeech: "verb", pronunciationGuide: "on-THA-ri" },
  { word: "vinchel", bengaliMeaning: "ছাড়", englishMeaning: "discount", partOfSpeech: "noun", pronunciationGuide: "VIN-chel" },
  { word: "revoni", bengaliMeaning: "পর্যালোচনা", englishMeaning: "review", partOfSpeech: "noun", pronunciationGuide: "re-VO-ni" },
  { word: "trenudo", bengaliMeaning: "চুক্তিপত্র", englishMeaning: "contract", partOfSpeech: "noun", pronunciationGuide: "tre-NU-do" },
  { word: "invona", bengaliMeaning: "ইনভয়েস", englishMeaning: "invoice", partOfSpeech: "noun", pronunciationGuide: "in-VO-na" },
  { word: "prestat", bengaliMeaning: "প্রস্তুত", englishMeaning: "ready", partOfSpeech: "adjective", pronunciationGuide: "pres-TAT" },
  { word: "delovi", bengaliMeaning: "ডেলিভারি", englishMeaning: "delivery", partOfSpeech: "noun", pronunciationGuide: "de-LO-vi" },
  { word: "purnaka", bengaliMeaning: "সম্পূর্ণ", englishMeaning: "complete", partOfSpeech: "adjective", pronunciationGuide: "pur-NA-ka" },
  { word: "dhonnor", bengaliMeaning: "ধন্যবাদ জানানো", englishMeaning: "thank", partOfSpeech: "verb", pronunciationGuide: "DHON-nor" },
  { word: "bonivar", bengaliMeaning: "ক্রেতা", englishMeaning: "customer", partOfSpeech: "noun", pronunciationGuide: "bo-NI-var" },
  { word: "misevo", bengaliMeaning: "সভা", englishMeaning: "meeting", partOfSpeech: "noun", pronunciationGuide: "mi-SE-vo" },
  { word: "ornavi", bengaliMeaning: "শুরু করা", englishMeaning: "start", partOfSpeech: "verb", pronunciationGuide: "or-NA-vi" },
  { word: "sevani", bengaliMeaning: "পাঠানো", englishMeaning: "send", partOfSpeech: "verb", pronunciationGuide: "se-VA-ni" },
  { word: "ripono", bengaliMeaning: "রিপোর্ট", englishMeaning: "report", partOfSpeech: "noun", pronunciationGuide: "ri-PO-no" },
  { word: "simoni", bengaliMeaning: "সময়সীমা", englishMeaning: "deadline", partOfSpeech: "noun", pronunciationGuide: "si-MO-ni" },
  { word: "solven", bengaliMeaning: "গোপনীয়", englishMeaning: "confidential", partOfSpeech: "adjective", pronunciationGuide: "SOL-ven" },

  // Everyday business vocabulary.
  { word: "velkin", bengaliMeaning: "গ্রাহক", englishMeaning: "client", partOfSpeech: "noun", pronunciationGuide: "VEL-kin" },
  { word: "ordona", bengaliMeaning: "অর্ডার", englishMeaning: "order", partOfSpeech: "noun", pronunciationGuide: "or-DO-na" },
  { word: "suploni", bengaliMeaning: "সরবরাহকারী", englishMeaning: "supplier", partOfSpeech: "noun", pronunciationGuide: "sup-LO-ni" },
  { word: "gothano", bengaliMeaning: "গুদাম", englishMeaning: "warehouse", partOfSpeech: "noun", pronunciationGuide: "go-THA-no" },
  { word: "dhaniko", bengaliMeaning: "অর্থ", englishMeaning: "money", partOfSpeech: "noun", pronunciationGuide: "dha-NI-ko" },
  { word: "benkon", bengaliMeaning: "ব্যাংক", englishMeaning: "bank", partOfSpeech: "noun", pronunciationGuide: "BEN-kon" },
  { word: "hishebi", bengaliMeaning: "হিসাব", englishMeaning: "account", partOfSpeech: "noun", pronunciationGuide: "hi-SHE-bi" },
  { word: "kormavi", bengaliMeaning: "কর্মচারী", englishMeaning: "employee", partOfSpeech: "noun", pronunciationGuide: "kor-MA-vi" },
  { word: "porival", bengaliMeaning: "ব্যবস্থাপক", englishMeaning: "manager", partOfSpeech: "noun", pronunciationGuide: "po-RI-val" },
  { word: "dhaftor", bengaliMeaning: "দফতর", englishMeaning: "office", partOfSpeech: "noun", pronunciationGuide: "DHAF-tor" },
  { word: "bartaon", bengaliMeaning: "বার্তা", englishMeaning: "message", partOfSpeech: "noun", pronunciationGuide: "bar-TA-on" },
  { word: "shakhon", bengaliMeaning: "স্বাক্ষর", englishMeaning: "signature", partOfSpeech: "noun", pronunciationGuide: "sha-KHON" },
  { word: "montash", bengaliMeaning: "মান", englishMeaning: "quality", partOfSpeech: "noun", pronunciationGuide: "mon-TASH" },
  { word: "poloni", bengaliMeaning: "পরিকল্পনা", englishMeaning: "plan", partOfSpeech: "noun", pronunciationGuide: "po-LO-ni" },
  { word: "khoravi", bengaliMeaning: "খরচ", englishMeaning: "cost", partOfSpeech: "noun", pronunciationGuide: "kho-RA-vi" },
  { word: "bajeton", bengaliMeaning: "বাজেট", englishMeaning: "budget", partOfSpeech: "noun", pronunciationGuide: "ba-JE-ton" },
  { word: "foloni", bengaliMeaning: "ফলাফল", englishMeaning: "result", partOfSpeech: "noun", pronunciationGuide: "fo-LO-ni" },
  { word: "somponi", bengaliMeaning: "সমস্যা", englishMeaning: "problem", partOfSpeech: "noun", pronunciationGuide: "som-PO-ni" },
  { word: "utorani", bengaliMeaning: "উত্তর", englishMeaning: "answer", partOfSpeech: "noun", pronunciationGuide: "u-to-RA-ni" },
  { word: "nirapad", bengaliMeaning: "নিরাপদ", englishMeaning: "safe", partOfSpeech: "adjective", pronunciationGuide: "ni-RA-pad" },
  { word: "dorbhara", bengaliMeaning: "দরদাম", englishMeaning: "bargain", partOfSpeech: "noun", pronunciationGuide: "dor-BHA-ra" }
];

export interface StarterResult {
  added: number;
  skipped: number;
}

/** Idempotent: words already in the dictionary (any status, archived
 * included) are skipped, never duplicated. */
export async function addStarterDictionary(
  store: DataStore,
  workspaceId: string,
): Promise<StarterResult> {
  const existing = new Set(
    (
      await store.findEntries(workspaceId, { includeArchived: true })
    ).map((r) => r.normalized_word),
  );
  let added = 0;
  let skipped = 0;
  const now = nowIso();
  for (const item of STARTER_DICTIONARY) {
    const norm = normalizeWord(item.word);
    if (existing.has(norm)) {
      skipped += 1;
      continue;
    }
    existing.add(norm);
    await store.insertEntry({
      id: uid(),
      workspace_id: workspaceId,
      language_id: null,
      word: item.word,
      normalized_word: norm,
      bengali_meaning: item.bengaliMeaning,
      english_meaning: item.englishMeaning,
      pronunciation_guide: item.pronunciationGuide,
      ipa: "",
      part_of_speech: item.partOfSpeech,
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
      updated_at: now,
    });
    added += 1;
  }
  return { added, skipped };
}
