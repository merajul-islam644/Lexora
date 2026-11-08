import { bundledByLanguage, defaultDictionary } from "./dictionary.js";

/* Lexora i18n, built on the Blocks Localization service through the shared
   `blocksClient` singleton (src/web/lib/blocks/client.ts). English and
   Bengali ship in the bundle (blocks/localization/*.en-US.json /
   *.bn-BD.json, re-exported through dictionary.ts) so first paint is always
   correct in both languages — বাংলা works offline and before the first
   cloud load. The selected language's cloud dictionary is fetched with the
   SDK's public loader (works pre-login) and layered on top. Missing key →
   bundled value for the active language → bundled English → the key. */

/** A language the switcher offers. Codes are the tenant's configured
    cultures (the Localization service's language list); the list itself is
    fetched at runtime, so languages configured portal-side appear here
    without a redeploy. */
export type LanguageOption = { code: string; label: string };

/** Widened from a union of literals: the code set is the tenant's, not the
    bundle's — any configured culture is a valid value. */
export type LanguageCode = string;

/* Boot list — what the bundle itself ships (see dictionary.ts). The provider
   swaps in the tenant's configured list once it loads. */
export const FALLBACK_LANGUAGES: LanguageOption[] = [
  { code: "en-US", label: "English" },
  { code: "bn-BD", label: "বাংলা" },
  { code: "de-DE", label: "Deutsch" }
];

/* Native names beat the portal's English display names inside the picker
   (a German picker showing "Bengali" would be odd); anything unmapped falls
   back to the configured name. Keyed by primary subtag so bn-BD and bn-IN
   both match. */
const NATIVE_LABELS: Record<string, string> = {
  en: "English",
  bn: "বাংলা",
  de: "Deutsch"
};

export function nativeLabel(code: string, configuredName?: string): string {
  const primary = code.split(/[-_]/)[0].toLowerCase();
  return NATIVE_LABELS[primary] ?? configuredName ?? code;
}

export const DEFAULT_LANGUAGE: LanguageCode = "en-US";
export const LANGUAGE_STORAGE_KEY = "lexora.lang";

/** The modules pushed to the Localization service and loaded at runtime.
   Keep in sync with blocks/localization/<module>.<language>.json files. */
export const MODULES = [
  "common",
  "landing",
  "app",
  "auth",
  "dashboard",
  "dictionary",
  "generation",
  "practice",
  "tools",
  "grammar",
  "workspace",
  "profile",
] as const;

/* --- module-scope active state; plain t() reads it synchronously --------- */

let cloudDictionary: Record<string, string> = {};
/* Seeded from storage, not hardwired to the default: a returning visitor's
   language must apply from the very first render — the provider's cloud
   load is async, and waiting for it would paint one language while the
   switcher already shows another. */
let activeLanguage: LanguageCode = readStoredLanguage();

type Params = Record<string, string | number>;

/** Replace {name} placeholders in a translated string. */
function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name) =>
    name in params ? String(params[name]) : m
  );
}

/** Translate a key: cloud dictionary → bundled dictionary for the active
   language → bundled English → the key. Never throws, never fetches.
   Components call this directly; the provider's language state triggers the
   re-render that picks up new values.

   The cloud layer can briefly serve the service's own "[ KEY MISSING ]"
   placeholder for a just-pushed key (the UILM file regenerates
   asynchronously after a push — see the localization skill's gotchas).
   Treating that marker as "no value" keeps the bundled translation visible
   during that window instead of leaking service internals into the UI. */
const CLOUD_MISSING_MARKER = "[ KEY MISSING ]";

export function t(key: string, params?: Params): string {
  const bundled =
    (bundledByLanguage as Record<string, Record<string, string>>)[activeLanguage] ?? defaultDictionary;
  const cloudValue = cloudDictionary[key];
  const template =
    cloudValue && cloudValue !== CLOUD_MISSING_MARKER
      ? cloudValue
      : bundled[key] ?? defaultDictionary[key] ?? key;
  return interpolate(template, params);
}

/** The language the UI is currently rendering in. */
export function currentLanguage(): LanguageCode {
  return activeLanguage;
}

/** The languages known so far — the boot fallback list until the provider
   registers the tenant's configured list. */
let configuredLanguages: LanguageOption[] = FALLBACK_LANGUAGES;

export function currentLanguages(): LanguageOption[] {
  return configuredLanguages;
}

/** Called by the provider once the tenant's configured languages load.
   Order from the portal is preserved. */
export function registerLanguages(languages: LanguageOption[]): void {
  if (languages.length > 0) configuredLanguages = languages;
}

/** Called by the provider after each successful (or failed) load. */
export function setActiveDictionary(language: LanguageCode, dictionary: Record<string, string>): void {
  activeLanguage = language;
  cloudDictionary = dictionary;
  document.documentElement.lang = language.split(/[-_]/)[0].toLowerCase();
}

/* Anything matching a BCP-47-ish culture code is accepted from storage:
   the switcher only ever writes codes from the tenant list, and that list
   is fetched at runtime — stricter validation at read time would reject a
   perfectly good stored code before the list arrives. */
const CULTURE_PATTERN = /^[A-Za-z]{2,3}[-_][A-Za-z0-9]{2,8}$/;

export function readStoredLanguage(): LanguageCode {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored && CULTURE_PATTERN.test(stored)) return stored;
  } catch {
    /* private mode / cleared storage — fall through to the default */
  }
  return DEFAULT_LANGUAGE;
}

/** Whether the visitor has ever picked a language in this browser. The
   provider uses this to decide whether the tenant's default should win. */
export function hasStoredLanguage(): boolean {
  try {
    return Boolean(localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return false;
  }
}

export function storeLanguage(language: LanguageCode): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    /* non-fatal: the choice just won't survive a reload */
  }
}
