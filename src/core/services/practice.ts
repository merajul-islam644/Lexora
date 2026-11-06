import { uid, nowIso } from "../db/ids.js";
import { HttpError } from "../lib/http.js";
import type { EntryRow } from "../db/rows.js";
import type { DataStore } from "../db/store.js";
import type { PracticeMode } from "../../shared/schemas.js";

export interface PracticeItem {
  entryId: string;
  word: string;
  bengaliMeaning: string;
  englishMeaning: string;
  pronunciationGuide: string;
  partOfSpeech: string;
  mode: PracticeMode;
  status: string;
  /** Deterministic MCQ options (correct word first shuffled in) for the
   * multiple-choice modes; absent for typed and self-report modes. */
  options?: string[];
  /** An example sentence with the target word blanked out, for fill_blank
   * and choose_word context; absent when no sentence mentions the word. */
  contextSentence?: string;
}

export interface PracticeStats {
  total: number;
  new: number;
  learning: number;
  remembered: number;
  needsRevision: number;
  dueNow: number;
  lastReviewedAt: string | null;
}

const MODES: PracticeMode[] = [
  "word_to_bengali",
  "word_to_english",
  "bengali_to_word",
  "english_to_word",
  "fill_blank",
  "choose_word",
  "pronunciation"
];

const MCQ_MODES = new Set<PracticeMode>(["bengali_to_word", "english_to_word", "choose_word"]);

/** Small deterministic string hash so MCQ distractors are stable per item. */
function stableSeed(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface StoredSentence {
  constructed?: string;
  english?: string;
}

function readSentences(json: string): StoredSentence[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as StoredSentence[]) : [];
  } catch {
    return [];
  }
}

/** Picks 3 deterministic distractor words and shuffles them with the answer. */
function buildOptions(answer: string, pool: string[], seedText: string): string[] {
  const seed = stableSeed(seedText);
  const picks: string[] = [];
  for (let i = 0; i < pool.length && picks.length < 3; i++) {
    const candidate = pool[(seed + i * 7) % pool.length];
    if (candidate !== answer && !picks.includes(candidate)) picks.push(candidate);
  }
  const options = [answer, ...picks];
  // Deterministic LCG shuffle.
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options;
}

/** The first stored example sentence that uses the word, with the word
 * blanked out; null when none does. */
function buildContextSentence(word: string, sentencesJson: string): string | null {
  const hit = readSentences(sentencesJson).find(
    (s) => s.constructed && new RegExp(escapeRegExp(word), "i").test(s.constructed),
  );
  if (!hit?.constructed) return null;
  return hit.constructed.replace(new RegExp(escapeRegExp(word), "i"), "____");
}

/** Words due for review. A word the user has never seen counts as due. */
export async function getPracticeQueue(
  store: DataStore,
  workspaceId: string,
  userId: string,
  mode: PracticeMode | "mixed",
  limit = 10
): Promise<PracticeItem[]> {
  const now = nowIso();
  const [entries, progress] = await Promise.all([
    store.findEntries(workspaceId),
    store.listProgress(workspaceId, userId)
  ]);
  const approved = entries.filter((e) => e.status === "approved");
  const byEntry = new Map(progress.map((p) => [p.dictionary_entry_id, p]));
  const due = approved
    .map((entry) => ({ entry, p: byEntry.get(entry.id) }))
    .filter(({ p }) => !p || !p.next_review_at || p.next_review_at <= now)
    .sort((a, b) => (a.p?.next_review_at ?? "").localeCompare(b.p?.next_review_at ?? "") || a.entry.created_at.localeCompare(b.entry.created_at))
    .slice(0, Math.min(50, Math.max(1, limit)));

  const pool = approved.filter((e) => e.word && e.word !== "").map((e) => e.word);
  return due.map(({ entry, p }, index) => {
    const chosenMode: PracticeMode = mode === "mixed" ? MODES[index % MODES.length] : mode;
    const item: PracticeItem = {
      entryId: entry.id,
      word: entry.word,
      bengaliMeaning: entry.bengali_meaning,
      englishMeaning: entry.english_meaning,
      pronunciationGuide: entry.pronunciation_guide,
      partOfSpeech: entry.part_of_speech,
      mode: chosenMode,
      status: p?.status ?? "new"
    };
    if (MCQ_MODES.has(chosenMode)) {
      item.options = buildOptions(entry.word, pool, `${entry.id}:${chosenMode}`);
    }
    if (chosenMode === "fill_blank" || chosenMode === "choose_word") {
      item.contextSentence = buildContextSentence(entry.word, entry.example_sentences_json) ?? undefined;
    }
    return item;
  });
}

/**
 * SM-2-inspired spaced repetition. An answer must actually be submitted —
 * opening a card never marks a word mastered (spec §13).
 */
export async function applyReview(
  store: DataStore,
  params: { workspaceId: string; userId: string; entryId: string; mode: PracticeMode; correct: boolean }
): Promise<{ status: string; nextReviewAt: string; correctCount: number; incorrectCount: number }> {
  const entry = await store.getEntryById(params.entryId, params.workspaceId);
  if (!entry) throw new HttpError(404, "Word not found", "not_found");

  const existing = await store.getProgress(params.userId, params.entryId);

  const now = Date.now();
  let correctCount = existing?.correct_count ?? 0;
  let incorrectCount = existing?.incorrect_count ?? 0;
  let intervalDays = existing?.interval_days ?? 0;
  let status: string;

  if (params.correct) {
    correctCount += 1;
    intervalDays = intervalDays === 0 ? 1 : Math.min(60, intervalDays * 2.4);
    status = correctCount >= 3 ? "remembered" : "learning";
  } else {
    incorrectCount += 1;
    intervalDays = 0;
    status = "needs_revision";
  }

  const nextReviewAt = new Date(now + (intervalDays === 0 ? 10 * 60 * 1000 : intervalDays * 86_400_000)).toISOString();
  const nowIsoStr = nowIso();

  await store.upsertProgress({
    id: existing?.id ?? uid(),
    workspace_id: params.workspaceId,
    user_id: params.userId,
    language_id: entry.language_id,
    dictionary_entry_id: entry.id,
    status,
    last_reviewed_at: nowIsoStr,
    next_review_at: nextReviewAt,
    correct_count: correctCount,
    incorrect_count: incorrectCount,
    interval_days: intervalDays,
    updated_at: nowIsoStr
  });

  // Mirror coarse status onto the entry for dashboard stats.
  await store.setEntryLearning(entry.id, status, nowIsoStr);

  return { status, nextReviewAt, correctCount, incorrectCount };
}

export async function getPracticeStats(store: DataStore, workspaceId: string, userId: string): Promise<PracticeStats> {
  const [entries, progress] = await Promise.all([
    store.findEntries(workspaceId),
    store.listProgress(workspaceId, userId)
  ]);
  const approved = entries.filter((e) => e.status === "approved");
  const byEntry = new Map(progress.map((p) => [p.dictionary_entry_id, p]));
  const now = nowIso();

  let dueNow = 0;
  const counts = { new: 0, learning: 0, remembered: 0, needs_revision: 0 } as Record<string, number>;
  for (const entry of approved) {
    const p = byEntry.get(entry.id);
    const status = p?.status ?? "new";
    counts[status] = (counts[status] ?? 0) + 1;
    if (!p || !p.next_review_at || p.next_review_at <= now) dueNow += 1;
  }
  const lastReviewedAt = progress
    .map((p) => p.last_reviewed_at ?? "")
    .filter(Boolean)
    .sort()
    .pop() ?? null;

  return {
    total: approved.length,
    new: counts.new ?? 0,
    learning: counts.learning ?? 0,
    remembered: counts.remembered ?? 0,
    needsRevision: counts.needs_revision ?? 0,
    dueNow,
    lastReviewedAt
  };
}
