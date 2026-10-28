/* Identity-free helpers shared by the function bundle, the SQLite store and
   the SPA's Gateway data layer. Pure: no Node imports, safe in the browser. */

export function uid(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  // RFC4122 v4 fallback for runtimes without WebCrypto (older Node).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Normalize a constructed word for uniqueness checks (spec §9). NFC + lowercase. */
export function normalizeWord(word: string): string {
  return word.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
}
