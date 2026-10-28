import type { ExampleSentence, LearningStatus, LangSource, PartOfSpeech } from "../../shared/schemas.js";

/* Row → DTO mappers. SQLite rows are snake_case; DTOs are camelCase for the API. */

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  email_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export function toPublicUser(row: UserRow): {
  id: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
} {
  return {
    id: row.id,
    email: row.email,
    emailVerified: Boolean(row.email_verified_at),
    createdAt: row.created_at
  };
}

export interface EntryRow {
  id: string;
  workspace_id: string;
  language_id: string | null;
  word: string;
  normalized_word: string;
  bengali_meaning: string;
  english_meaning: string;
  pronunciation_guide: string;
  ipa: string;
  part_of_speech: string;
  root: string;
  word_formation_explanation: string;
  prefixes: string;
  suffixes: string;
  grammar_notes: string;
  example_sentences_json: string;
  related_word_ids_json: string;
  mnemonic: string;
  learning_status: LearningStatus;
  source: LangSource;
  status: "draft" | "approved";
  archived: number;
  entry_version: number;
  history_json: string;
  created_at: string;
  updated_at: string;
}

export interface DictionaryEntryDTO {
  id: string;
  workspaceId: string;
  languageId: string | null;
  word: string;
  bengaliMeaning: string;
  englishMeaning: string;
  pronunciationGuide: string;
  ipa: string;
  partOfSpeech: PartOfSpeech | string;
  root: string;
  wordFormationExplanation: string;
  prefixes: string;
  suffixes: string;
  grammarNotes: string;
  exampleSentences: ExampleSentence[];
  relatedWordIds: string[];
  mnemonic: string;
  learningStatus: LearningStatus;
  source: LangSource;
  status: "draft" | "approved";
  archived: boolean;
  version: number;
  history: Array<{ at: string; changes: Record<string, { from: unknown; to: unknown }> }>;
  createdAt: string;
  updatedAt: string;
}

function safeParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function toEntryDTO(row: EntryRow): DictionaryEntryDTO {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    languageId: row.language_id,
    word: row.word,
    bengaliMeaning: row.bengali_meaning,
    englishMeaning: row.english_meaning,
    pronunciationGuide: row.pronunciation_guide,
    ipa: row.ipa,
    partOfSpeech: row.part_of_speech,
    root: row.root,
    wordFormationExplanation: row.word_formation_explanation,
    prefixes: row.prefixes,
    suffixes: row.suffixes,
    grammarNotes: row.grammar_notes,
    exampleSentences: safeParse<ExampleSentence[]>(row.example_sentences_json, []),
    relatedWordIds: safeParse<string[]>(row.related_word_ids_json, []),
    mnemonic: row.mnemonic,
    learningStatus: row.learning_status,
    source: row.source,
    status: row.status,
    archived: Boolean(row.archived),
    version: row.entry_version,
    history: safeParse(row.history_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export interface LanguageRow {
  id: string;
  workspace_id: string;
  name: string;
  normalized_name: string;
  description: string;
  status: string;
  version: number;
  profile_json: string;
  created_at: string;
  updated_at: string;
}

export interface JobRow {
  id: string;
  workspace_id: string;
  user_id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "timeout";
  stages_json: string;
  result_json: string | null;
  error: string | null;
  style: string;
  reference_langs: string;
  preferred_name: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}
