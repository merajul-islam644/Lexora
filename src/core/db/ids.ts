import crypto from "node:crypto";

/* Identity-free helpers shared by the function bundle and the SQLite store.
   Split from connection.ts so pure-domain code never imports node:sqlite. */

export function uid(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Normalize a constructed word for uniqueness checks (spec §9). NFC + lowercase. */
export function normalizeWord(word: string): string {
  return word.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
}
