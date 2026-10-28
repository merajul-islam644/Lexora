import { uid, nowIso, normalizeWord } from "../db/ids.js";
import { logActivity } from "./activity.js";
import { importRowSchema, type ImportRow, type ExampleSentence } from "../../shared/schemas.js";
import type { EntryRow } from "../db/rows.js";
import type { DataStore } from "../db/store.js";

/* --------------------------------- CSV -------------------------------------- */

/** RFC4180-ish CSV parser: quoted fields, escaped quotes, embedded newlines. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export const CSV_TEMPLATE_HEADERS = [
  "word",
  "bengaliMeaning",
  "englishMeaning",
  "pronunciationGuide",
  "ipa",
  "partOfSpeech",
  "root",
  "mnemonic",
  "grammarNotes"
] as const;

const HEADER_ALIASES: Record<string, string> = {
  word: "word", term: "word", name: "word",
  bengalimeaning: "bengaliMeaning", bengali: "bengaliMeaning", bn: "bengaliMeaning", "বাংলা": "bengaliMeaning",
  englishmeaning: "englishMeaning", english: "englishMeaning", en: "englishMeaning", meaning: "englishMeaning",
  pronunciationguide: "pronunciationGuide", pronunciation: "pronunciationGuide",
  ipa: "ipa",
  partofspeech: "partOfSpeech", pos: "partOfSpeech",
  root: "root",
  mnemonic: "mnemonic",
  grammarnotes: "grammarNotes", notes: "grammarNotes"
};

export function gridToImportRows(grid: string[][]): { rows: ImportRow[]; headerErrors: string[] } {
  if (grid.length === 0) return { rows: [], headerErrors: ["The file is empty."] };
  const headerRaw = grid[0].map((h) => h.trim().toLowerCase());
  const header = headerRaw.map((h) => HEADER_ALIASES[h] ?? "");
  const headerErrors: string[] = [];
  if (!header.includes("word")) {
    headerErrors.push('CSV must have a "word" column. Download the template for the exact format.');
    return { rows: [], headerErrors };
  }
  const rows: ImportRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i];
    const record: Record<string, string> = {};
    header.forEach((name, idx) => {
      if (!name) return;
      const value = (cells[idx] ?? "").trim();
      if (value !== "") record[name] = value;
    });
    if (Object.keys(record).length === 0) continue;
    const parsed = importRowSchema.safeParse(record);
    if (parsed.success) rows.push(parsed.data);
  }
  return { rows, headerErrors };
}

/* ------------------------------- JSON import -------------------------------- */

export function jsonToImportRows(content: string): { rows: ImportRow[]; headerErrors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return { rows: [], headerErrors: ["The file is not valid JSON."] };
  }
  const list = Array.isArray(data) ? data : Array.isArray((data as { entries?: unknown }).entries) ? (data as { entries: unknown[] }).entries : null;
  if (!list) return { rows: [], headerErrors: ["JSON must be an array of word objects (or { \"entries\": [...] })"] };
  const rows: ImportRow[] = [];
  const raw = list as Array<Record<string, unknown>>;
  for (const item of raw) {
    const record: Record<string, string> = {};
    for (const key of ["word", "bengaliMeaning", "englishMeaning", "pronunciationGuide", "ipa", "partOfSpeech", "root", "mnemonic", "grammarNotes"]) {
      const value = item[key] ?? item[key.replace("Meaning", "_meaning")] ?? item[key.replace("Meaning", "")];
      if (typeof value === "string" && value.trim() !== "") record[key] = value.trim();
    }
    const parsed = importRowSchema.safeParse(record);
    if (parsed.success) rows.push(parsed.data);
  }
  return { rows, headerErrors: [] };
}

/* --------------------------------- report ----------------------------------- */

export interface ImportReport {
  totalRows: number;
  validCount: number;
  invalid: Array<{ row: number; word: string; issues: string[] }>;
  duplicatesInFile: Array<{ row: number; word: string }>;
  duplicatesInDictionary: Array<{ row: number; word: string; existing: string }>;
  warnings: string[];
  rows: ImportRow[];
}

export async function buildImportReport(store: DataStore, workspaceId: string, rows: ImportRow[]): Promise<ImportReport> {
  const report: ImportReport = {
    totalRows: rows.length,
    validCount: 0,
    invalid: [],
    duplicatesInFile: [],
    duplicatesInDictionary: [],
    warnings: [],
    rows: []
  };
  const seen = new Set<string>();
  const existing = new Set(
    (await store.findEntries(workspaceId)).map((r) => r.normalized_word)
  );

  rows.forEach((row, index) => {
    const rowNo = index + 1;
    const check = importRowSchema.safeParse(row);
    if (!check.success) {
      report.invalid.push({ row: rowNo, word: row.word ?? "", issues: check.error.issues.map((i) => `${i.path.join(".") || "row"}: ${i.message}`) });
      return;
    }
    const norm = normalizeWord(row.word);
    if (seen.has(norm)) {
      report.duplicatesInFile.push({ row: rowNo, word: row.word });
      return;
    }
    if (existing.has(norm)) {
      report.duplicatesInDictionary.push({ row: rowNo, word: row.word, existing: row.word });
      return;
    }
    if (!row.bengaliMeaning && !row.englishMeaning) {
      report.warnings.push(`Row ${rowNo} ("${row.word}") has no Bengali or English reference meaning.`);
    }
    seen.add(norm);
    report.validCount += 1;
    report.rows.push(row);
  });

  return report;
}

export interface ImportCommitResult {
  imported: number;
  skippedDuplicates: number;
}

export async function commitImport(store: DataStore, workspaceId: string, userId: string, rows: ImportRow[]): Promise<ImportCommitResult> {
  const report = await buildImportReport(store, workspaceId, rows);
  const now = nowIso();
  const language = await store.getLanguageByWorkspace(workspaceId);
  // Sequential inserts -- the gateway has no cross-record transaction; a
  // partial import can be cleaned up by re-importing (duplicates are skipped).
  for (const row of report.rows) {
    const norm = normalizeWord(row.word);
    await store.insertEntry({
      id: uid(),
      workspace_id: workspaceId,
      language_id: language?.id ?? null,
      word: row.word,
      normalized_word: norm,
      bengali_meaning: row.bengaliMeaning ?? "",
      english_meaning: row.englishMeaning ?? "",
      pronunciation_guide: row.pronunciationGuide ?? "",
      ipa: row.ipa ?? "",
      part_of_speech: row.partOfSpeech ?? "noun",
      root: row.root ?? "",
      word_formation_explanation: "",
      prefixes: "",
      suffixes: "",
      grammar_notes: row.grammarNotes ?? "",
      example_sentences_json: "[]",
      related_word_ids_json: "[]",
      mnemonic: row.mnemonic ?? "",
      learning_status: "new",
      source: "imported",
      status: "approved",
      archived: 0,
      entry_version: 1,
      history_json: "[]",
      created_at: now,
      updated_at: now
    });
  }
  if (report.rows.length > 0) {
    await logActivity(store, {
      workspaceId,
      actorUserId: userId,
      action: "dictionary.imported",
      resourceType: "dictionary",
      resourceId: workspaceId,
      metadata: { imported: report.rows.length }
    });
  }
  return { imported: report.rows.length, skippedDuplicates: report.duplicatesInFile.length + report.duplicatesInDictionary.length };
}

/* --------------------------------- export ----------------------------------- */

export async function exportEntries(store: DataStore, workspaceId: string, format: "csv" | "json"): Promise<{ filename: string; contentType: string; body: string }> {
  const entries = (await store.findEntries(workspaceId))
    .sort((a, b) => a.word.localeCompare(b.word, undefined, { sensitivity: "base" }));

  if (format === "json") {
    const payload = entries.map((e) => ({
      word: e.word,
      bengaliMeaning: e.bengali_meaning,
      englishMeaning: e.english_meaning,
      pronunciationGuide: e.pronunciation_guide,
      ipa: e.ipa,
      partOfSpeech: e.part_of_speech,
      root: e.root,
      mnemonic: e.mnemonic,
      grammarNotes: e.grammar_notes,
      source: e.source,
      status: e.status,
      exampleSentences: safeExamples(e),
      createdAt: e.created_at
    }));
    return {
      filename: `lexora-dictionary-${workspaceId.slice(0, 8)}.json`,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(payload, null, 2)
    };
  }

  const header = CSV_TEMPLATE_HEADERS as readonly string[];
  const lines = [header.join(",")];
  for (const e of entries) {
    lines.push(
      [
        e.word, e.bengali_meaning, e.english_meaning, e.pronunciation_guide, e.ipa,
        e.part_of_speech, e.root, e.mnemonic, e.grammar_notes
      ].map(csvEscape).join(",")
    );
  }
  return {
    filename: `lexora-dictionary-${workspaceId.slice(0, 8)}.csv`,
    contentType: "text/csv; charset=utf-8",
    body: lines.join("\n")
  };
}

function safeExamples(entry: EntryRow): ExampleSentence[] {
  try {
    return JSON.parse(entry.example_sentences_json) as ExampleSentence[];
  } catch {
    return [];
  }
}
