import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bengaliDictionary, bundledByLanguage, defaultDictionary, germanDictionary, prefixModule } from "../../src/web/i18n/dictionary.js";
import { MODULES } from "../../src/web/i18n/index.js";

/* The localization contract, enforced so a typo can never reach users as a
   raw key: en-US, bn-BD and de-DE carry the same keys per module, module
   files never repeat a key, merged keys are unique and CLI-charset-safe,
   interpolated params match across languages, and every t("…") literal in
   src/web exists in the bundled dictionary. */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const locDir = join(repoRoot, "blocks", "localization");

function loadModuleJson(module: string, language: string): Record<string, string> {
  return JSON.parse(readFileSync(join(locDir, `${module}.${language}.json`), "utf8")) as Record<string, string>;
}

/** Raw top-level keys straight from the file text — JSON.parse silently
    drops duplicates, this doesn't. Our seed files are flat objects. */
function rawKeys(module: string, language: string): string[] {
  const text = readFileSync(join(locDir, `${module}.${language}.json`), "utf8");
  return [...text.matchAll(/"([^"]+)"\s*:/g)].map((m) => m[1]);
}

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const paramsOf = (value: string): string =>
  [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/** Languages that ship in the bundle (and must therefore obey the full
    contract): English is the source of truth, the others mirror it. */
const MIRRORED_LANGUAGES = ["bn-BD", "de-DE"] as const;

describe("localization dictionaries", () => {
  it("every module has every language file with identical key sets", () => {
    for (const module of MODULES) {
      const en = loadModuleJson(module, "en-US");
      for (const language of MIRRORED_LANGUAGES) {
        expect(Object.keys(en).sort(), `${module}: en-US vs ${language} key mismatch`).toEqual(
          Object.keys(loadModuleJson(module, language)).sort()
        );
      }
    }
  });

  it("no module file repeats a key (JSON.parse would silently hide it)", () => {
    for (const module of MODULES) {
      for (const language of ["en-US", ...MIRRORED_LANGUAGES]) {
        const keys = rawKeys(module, language);
        expect(new Set(keys).size, `${module}.${language}: duplicate key`).toBe(keys.length);
      }
    }
  });

  it("keys match the Blocks CLI charset ^[A-Za-z0-9][A-Za-z0-9._:-]*$", () => {
    for (const module of MODULES) {
      for (const language of ["en-US", ...MIRRORED_LANGUAGES]) {
        for (const key of Object.keys(loadModuleJson(module, language))) {
          expect(`${module}.${key}`).toMatch(KEY_PATTERN);
        }
      }
    }
  });

  it("merged dictionary is unique and complete after module prefixing", () => {
    let total = 0;
    const seen = new Set<string>();
    for (const module of MODULES) {
      const prefixed = prefixModule(module, loadModuleJson(module, "en-US"));
      total += Object.keys(prefixed).length;
      for (const key of Object.keys(prefixed)) {
        expect(seen.has(key), `collision on ${key}`).toBe(false);
        seen.add(key);
      }
    }
    expect(seen.size).toBe(total);
    expect(Object.keys(defaultDictionary).length).toBe(total);
  });

  it("every bundled non-English fallback mirrors the merged dictionary key-for-key", () => {
    for (const [language, bundled] of [
      ["bn-BD", bengaliDictionary],
      ["de-DE", germanDictionary]
    ] as const) {
      let total = 0;
      for (const module of MODULES) {
        total += Object.keys(loadModuleJson(module, language)).length;
      }
      expect(Object.keys(bundled).length, `${language} bundled size`).toBe(total);
      expect(bundledByLanguage[language]).toBe(bundled);
    }
  });

  it("interpolation params agree between en-US and every mirrored language", () => {
    for (const module of MODULES) {
      const en = loadModuleJson(module, "en-US");
      for (const language of MIRRORED_LANGUAGES) {
        const translated = loadModuleJson(module, language);
        for (const key of Object.keys(en)) {
          expect(paramsOf(en[key]), `${module}.${key}: ${language} params`).toBe(paramsOf(translated[key]));
        }
      }
    }
  });

  it("every t(\"…\") literal in src/web resolves in the bundled dictionary", () => {
    const used = new Map<string, string>();
    const files = collectSourceFiles(join(repoRoot, "src", "web"));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\bt\(\s*["']([^"']+)["']/g)) {
        if (!used.has(match[1])) used.set(match[1], file);
      }
    }
    const missing = [...used.entries()].filter(([key]) => !(key in defaultDictionary));
    expect(
      missing.map(([key, file]) => `${key} (used in ${file})`),
      `t() keys missing from the dictionaries`
    ).toEqual([]);
  });

  it("used keys are always module-addressed (<module>.<rest>)", () => {
    const files = collectSourceFiles(join(repoRoot, "src", "web"));
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\bt\(\s*["']([^"']+)["']/g)) {
        const key = match[1];
        const module = key.split(".")[0];
        expect(
          (MODULES as readonly string[]).includes(module),
          `${key} in ${file} does not start with a known module`
        ).toBe(true);
      }
    }
  });
});
