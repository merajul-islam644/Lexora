import { cloneElement, createContext, Fragment, useContext, useEffect, isValidElement, useMemo, useState, type ReactNode } from "react";
import { blocksClient } from "../lib/blocks/client.js";
import { prefixModule } from "./dictionary.js";
import {
  DEFAULT_LANGUAGE,
  FALLBACK_LANGUAGES,
  MODULES,
  hasStoredLanguage,
  nativeLabel,
  readStoredLanguage,
  registerLanguages,
  setActiveDictionary,
  storeLanguage,
  t,
  type LanguageCode,
  type LanguageOption
} from "./index.js";

/* Mirrors the canonical Blocks scaffold provider: language state (seeded from
   localStorage) drives one effect that loads every module's dictionary for
   that language through the SDK's public localization loader — usable before
   sign-in, so the landing page can render in the visitor's language. Loading
   is best-effort: if the cloud is unreachable the UI silently falls back to
   the bundled dictionary for that language (English and Bengali both bundle;
   see dictionary.ts) rather than breaking the page.

   A second effect fetches the tenant's configured language list
   (localization → language list-for-tenant) and swaps it in for the boot
   fallback list, so languages configured portal-side appear in the
   switcher without a redeploy. */
type I18nContextValue = {
  language: LanguageCode;
  /** Languages the switcher offers: the tenant's configured list once it
      loads, the bundled fallback list before that. */
  languages: LanguageOption[];
  /** Switch language: persists the choice and loads that language's
      dictionaries (cached inside the SDK per language:module). */
  setLanguage: (language: LanguageCode) => void;
};

const I18nContext = createContext<I18nContextValue>({
  language: DEFAULT_LANGUAGE,
  languages: FALLBACK_LANGUAGES,
  setLanguage: () => {}
});

export function LocalizationProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>(readStoredLanguage);
  const [languages, setLanguages] = useState<LanguageOption[]>(FALLBACK_LANGUAGES);
  /* setActiveDictionary mutates module state that plain t() reads, but it
     isn't React state — nothing re-renders when it lands. A switch re-renders
     BEFORE the async load finishes (too early), and a stored language never
     changes state at all (never). This tick fires after each load completes,
     so the provider redraws with the settled dictionaries. */
  const [dictionaryTick, setDictionaryTick] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      // The tenant list needs a session (401 pre-login); the public catalog
      // resolves the same cultures through the x-blocks-key alone. Only if
      // both fail do we keep the bundled boot list.
      let tenant: Array<{ languageCode?: string; code?: string; culture?: string; languageName?: string; displayName?: string; isDefault?: boolean }> = [];
      try {
        tenant = await blocksClient.localization.languagesForCurrentTenant();
      } catch {
        try {
          tenant = await blocksClient.localization.languages();
        } catch {
          /* offline — keep the bundled boot list */
        }
      }
      if (!alive) return;
      const seen = new Set<string>();
      const options = tenant
        .map((l) => {
          const code = l.languageCode ?? l.code ?? l.culture ?? "";
          if (!code) return null; // can't be selected without a code
          return { code, label: nativeLabel(code, l.languageName ?? l.displayName) };
        })
        .filter((l): l is LanguageOption => l !== null && !seen.has(l.code) && (seen.add(l.code), true));
      if (options.length > 0) {
        setLanguages(options);
        registerLanguages(options);
        // A visitor who never chose follows the tenant's default language.
        const tenantDefault = tenant.find((l) => l.isDefault)?.languageCode;
        if (!hasStoredLanguage() && tenantDefault && tenantDefault !== DEFAULT_LANGUAGE) {
          setLanguageState(tenantDefault);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      // One load per module: the SDK returns each module's keys module-local
      // ("title"), and we namespace them to "<module>.<key>" — the same
      // transform the bundled dictionaries apply — so the two layers can
      // merge into one collision-free map. A module that fails to load drops
      // out alone; the other eleven (and the bundled dictionaries beneath
      // them) keep the UI usable.
      const dictionaries = await Promise.all(
        MODULES.map(async (module) => {
          try {
            const entries = await blocksClient.localization.load(language, [module]);
            return prefixModule(module, entries ?? {});
          } catch {
            return {};
          }
        })
      );
      if (!alive) return;
      setActiveDictionary(language, Object.assign({}, ...dictionaries));
      setDictionaryTick((tick) => tick + 1);
    })();
    return () => {
      alive = false;
    };
  }, [language]);

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      languages,
      setLanguage: (next) => {
        storeLanguage(next);
        setLanguageState(next);
      }
    }),
    [language, languages]
  );

  /* The subtree renders translated strings through the module-level t(),
     which React cannot see. Re-rendering is not enough either: bail-outs
     stack — an unchanged {children} reference skips the subtree, and inside
     it the router's unchanged <Route element> references skip every page.
     So a language change (or a load completing) REMOUNTS the subtree via a
     key change instead: every component executes fresh, re-reading t() with
     the settled module state. Acceptable cost — a language switch is a
     deliberate action, and pages already refetch their data on mount. */
  const i18nKey = `${language}:${dictionaryTick}`;
  const remounted = isValidElement(children)
    ? cloneElement(children, { key: i18nKey })
    : <Fragment key={i18nKey}>{children}</Fragment>;

  return <I18nContext.Provider value={value}>{remounted}</I18nContext.Provider>;
}

/** Only language-aware controls (the switcher) need this — everything else
    renders labels with the plain t() from index.js and re-renders because the
    provider's state change redraws the tree. */
export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

export { t };
