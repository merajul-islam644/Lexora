/* Thin typed wrapper around the lexora-api Blocks Function. Every call goes
 * through the SDK (blocksClient.logic.functions.invoke) with the signed-in
 * user's own token -- there is no self-hosted backend. The function keeps the
 * old JSON error contract { error: { code, message, details } }, so pages see
 * the same ApiError they always did. */

import { BlocksApiError, BlocksFunctionRunError } from "@seliseblocks/client";
import { blocksClient } from "./lib/blocks/client.js";
import { blocksConfig } from "./lib/blocks/config.js";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** "/api/ws/1/dictionary?q=x" -> { path: "ws/1/dictionary", query: { q: "x" } }. */
function splitPath(path: string): { path: string; query: Record<string, string | string[]> } {
  const noApi = path.replace(/^\/api\/?/, "");
  const [pathname, search = ""] = noApi.split("?");
  const query: Record<string, string | string[]> = {};
  for (const key of new Set(new URLSearchParams(search).keys())) {
    const all = new URLSearchParams(search).getAll(key);
    query[key] = all.length > 1 ? all : all[0] ?? "";
  }
  return { path: pathname.replace(/^\/+/, ""), query };
}

function apiErrorFrom(status: number, body: unknown): ApiError {
  const err = (body as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
  return new ApiError(status, err?.code ?? "error", err?.message ?? `Request failed (${status})`, err?.details);
}

/** One answered run: normalize to either the body or the contract ApiError. */
function unwrap<T>(status: number, body: unknown): T {
  if (status >= 400) throw apiErrorFrom(status, body);
  return body as T;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { path: fnPath, query } = splitPath(path);
  try {
    const result = await blocksClient.logic.functions.invoke<T>(blocksConfig.apiFunctionId, {
      method: method as "GET",
      path: fnPath,
      query,
      body,
      waitSeconds: 25
    });
    if (result.kind === "answered") return unwrap<T>(result.status, result.body);
    // A call that outlived the wait: the run still finishes -- collect it.
    const done = await blocksClient.logic.functions.waitForResult(
      { runId: result.runId, pollToken: result.pollToken ?? "" },
      { timeoutMs: 120_000 }
    );
    if (done.status !== "SUCCEEDED") {
      throw new ApiError(502, "function_run_failed", done.errorMessage ?? "The request did not finish. Please try again.");
    }
    return unwrap<T>(200, done.result ? JSON.parse(done.result) : {});
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof BlocksApiError) throw apiErrorFrom(err.status, err.body);
    if (err instanceof BlocksFunctionRunError) {
      throw new ApiError(502, "function_run_failed", err.errorMessage ?? err.message);
    }
    throw new ApiError(0, "network", err instanceof Error ? err.message : "Could not reach the API");
  }
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  del: <T>(path: string) => request<T>("DELETE", path)
};

/** Download an endpoint that answers with a { filename, contentType, content }
 *  envelope (the export routes) and save it client-side. */
export async function downloadFile(path: string): Promise<void> {
  const file = await api.get<{ filename: string; contentType: string; content: string }>(path);
  const blob = new Blob([file.content], { type: file.contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------ shared API types --------------------------- */

export interface PublicUser {
  id: string;
  email: string;
  /** IAM display name; empty when the token carries no name claim. */
  name?: string;
  emailVerified: boolean;
  createdAt: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: "owner" | "admin" | "editor" | "viewer";
  isDemo: boolean;
  languageName: string | null;
  wordCount: number;
  createdAt: string;
}

export interface EntryDTO {
  id: string;
  workspaceId: string;
  languageId: string | null;
  word: string;
  bengaliMeaning: string;
  englishMeaning: string;
  pronunciationGuide: string;
  ipa: string;
  partOfSpeech: string;
  root: string;
  wordFormationExplanation: string;
  prefixes: string;
  suffixes: string;
  grammarNotes: string;
  exampleSentences: Array<{ constructed: string; bengali: string; english: string }>;
  relatedWordIds: string[];
  mnemonic: string;
  learningStatus: string;
  source: "user" | "generated" | "imported";
  status: "draft" | "approved";
  archived: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ImportReport {
  totalRows: number;
  validCount: number;
  invalid: Array<{ row: number; word: string; issues: string[] }>;
  duplicatesInFile: Array<{ row: number; word: string }>;
  duplicatesInDictionary: Array<{ row: number; word: string; existing: string }>;
  warnings: string[];
  rows: Array<Record<string, string>>;
}

export interface LanguageSummary {
  id: string;
  name: string;
  nativeName: string;
  description: string;
  status: string;
  version: number;
  wordOrder: string | null;
  style: string | null;
  vocabularyCount: number;
  rulesCount: number;
  warnings: string[];
  versionSummary: string;
  createdAt: string;
  updatedAt: string;
}

export interface GrammarData {
  language: { id: string; name: string; nativeName: string; version: number; wordOrder: string };
  writingSystem: { type: string; description: string; alphabet: string[]; numerals: string; capitalization: string };
  phonology: {
    consonants: string[];
    vowels: string[];
    syllableStructures: string[];
    stressRule: string;
    forbiddenClusters: string[];
    pronunciationConventions: Array<{ symbol: string; guide: string }>;
  };
  wordFormation: {
    prefixes: Array<{ affix: string; meaning: string }>;
    suffixes: Array<{ affix: string; meaning: string }>;
  };
  rules: Array<{
    id: string;
    name: string;
    category: string;
    explanationEnglish: string;
    explanationBengali: string;
    pattern: string;
    validExamples: string[];
    invalidExamples: Array<{ example: string; why: string }>;
    introducedInVersion: number;
  }>;
}

export interface JobState {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "timeout";
  stages: Array<{ id: string; label: string; labelBn: string; status: "pending" | "running" | "done" }>;
  result: {
    languageId: string;
    name: string;
    nativeName: string;
    version: number;
    wordCount: number;
    rulesCount: number;
    generatedDrafts: number;
    warnings: string[];
  } | null;
  error: string | null;
}

export const PARTS_OF_SPEECH = ["noun", "verb", "adjective", "adverb", "pronoun", "preposition", "conjunction", "interjection", "phrase"] as const;
export const GEN_STYLES = ["naturalistic", "concise", "formal", "futuristic", "original"] as const;
export const PRACTICE_MODES = ["word_to_bengali", "word_to_english", "bengali_to_word", "english_to_word", "fill_blank", "choose_word", "pronunciation"] as const;
