import common from "../../../blocks/localization/common.en-US.json";
import landing from "../../../blocks/localization/landing.en-US.json";
import app from "../../../blocks/localization/app.en-US.json";
import auth from "../../../blocks/localization/auth.en-US.json";
import dashboard from "../../../blocks/localization/dashboard.en-US.json";
import dictionary from "../../../blocks/localization/dictionary.en-US.json";
import generation from "../../../blocks/localization/generation.en-US.json";
import practice from "../../../blocks/localization/practice.en-US.json";
import tools from "../../../blocks/localization/tools.en-US.json";
import grammar from "../../../blocks/localization/grammar.en-US.json";
import workspace from "../../../blocks/localization/workspace.en-US.json";
import profile from "../../../blocks/localization/profile.en-US.json";

import commonBn from "../../../blocks/localization/common.bn-BD.json";
import landingBn from "../../../blocks/localization/landing.bn-BD.json";
import appBn from "../../../blocks/localization/app.bn-BD.json";
import authBn from "../../../blocks/localization/auth.bn-BD.json";
import dashboardBn from "../../../blocks/localization/dashboard.bn-BD.json";
import dictionaryBn from "../../../blocks/localization/dictionary.bn-BD.json";
import generationBn from "../../../blocks/localization/generation.bn-BD.json";
import practiceBn from "../../../blocks/localization/practice.bn-BD.json";
import toolsBn from "../../../blocks/localization/tools.bn-BD.json";
import grammarBn from "../../../blocks/localization/grammar.bn-BD.json";
import workspaceBn from "../../../blocks/localization/workspace.bn-BD.json";
import profileBn from "../../../blocks/localization/profile.bn-BD.json";

import commonDe from "../../../blocks/localization/common.de-DE.json";
import landingDe from "../../../blocks/localization/landing.de-DE.json";
import appDe from "../../../blocks/localization/app.de-DE.json";
import authDe from "../../../blocks/localization/auth.de-DE.json";
import dashboardDe from "../../../blocks/localization/dashboard.de-DE.json";
import dictionaryDe from "../../../blocks/localization/dictionary.de-DE.json";
import generationDe from "../../../blocks/localization/generation.de-DE.json";
import practiceDe from "../../../blocks/localization/practice.de-DE.json";
import toolsDe from "../../../blocks/localization/tools.de-DE.json";
import grammarDe from "../../../blocks/localization/grammar.de-DE.json";
import workspaceDe from "../../../blocks/localization/workspace.de-DE.json";
import profileDe from "../../../blocks/localization/profile.de-DE.json";

/* The bundled English dictionary: one flat merged map from the en-US seed
   files under blocks/localization/. These are the SAME files pushed to the
   Blocks Localization service, so first paint (bundle) and cloud-loaded
   translations can never disagree on English. The cloud layer (see
   LocalizationProvider) only ever overrides keys for non-English languages
   or newer cloud-edited values.

   Keys inside a module file stay module-local (the Blocks Localization
   convention: the module lives in the filename, so "title" in grammar.json
   is grammar's title). The UI addresses keys globally as "<module>.<key>"
   — t("grammar.title") — so the twelve dictionaries can merge into one
   collision-free flat map. prefixModule applies that namespacing, and the
   cloud loader path (LocalizationProvider) applies the same transform. */

export function prefixModule(module: string, dictionary: Record<string, string>): Record<string, string> {
  const prefixed: Record<string, string> = {};
  for (const [key, value] of Object.entries(dictionary)) {
    prefixed[`${module}.${key}`] = value;
  }
  return prefixed;
}

export const defaultDictionary: Record<string, string> = Object.freeze({
  ...prefixModule("common", common as Record<string, string>),
  ...prefixModule("landing", landing as Record<string, string>),
  ...prefixModule("app", app as Record<string, string>),
  ...prefixModule("auth", auth as Record<string, string>),
  ...prefixModule("dashboard", dashboard as Record<string, string>),
  ...prefixModule("dictionary", dictionary as Record<string, string>),
  ...prefixModule("generation", generation as Record<string, string>),
  ...prefixModule("practice", practice as Record<string, string>),
  ...prefixModule("tools", tools as Record<string, string>),
  ...prefixModule("grammar", grammar as Record<string, string>),
  ...prefixModule("workspace", workspace as Record<string, string>),
  ...prefixModule("profile", profile as Record<string, string>)
});

/* Bundled non-English fallbacks, namespaced the same way. Bengali ships in
   the bundle so বাংলা works offline and before the first cloud load; the
   cloud's bn-BD values (identical by construction — same seed files) simply
   overlay these once loaded. */
export const bengaliDictionary: Record<string, string> = Object.freeze({
  ...prefixModule("common", commonBn as Record<string, string>),
  ...prefixModule("landing", landingBn as Record<string, string>),
  ...prefixModule("app", appBn as Record<string, string>),
  ...prefixModule("auth", authBn as Record<string, string>),
  ...prefixModule("dashboard", dashboardBn as Record<string, string>),
  ...prefixModule("dictionary", dictionaryBn as Record<string, string>),
  ...prefixModule("generation", generationBn as Record<string, string>),
  ...prefixModule("practice", practiceBn as Record<string, string>),
  ...prefixModule("tools", toolsBn as Record<string, string>),
  ...prefixModule("grammar", grammarBn as Record<string, string>),
  ...prefixModule("workspace", workspaceBn as Record<string, string>),
  ...prefixModule("profile", profileBn as Record<string, string>)
});

/* German ships the same way — these files are the Localization service's own
   machine translations (pulled back via `localization pull`), not hand
   edits, so bundle and cloud agree by construction. */
export const germanDictionary: Record<string, string> = Object.freeze({
  ...prefixModule("common", commonDe as Record<string, string>),
  ...prefixModule("landing", landingDe as Record<string, string>),
  ...prefixModule("app", appDe as Record<string, string>),
  ...prefixModule("auth", authDe as Record<string, string>),
  ...prefixModule("dashboard", dashboardDe as Record<string, string>),
  ...prefixModule("dictionary", dictionaryDe as Record<string, string>),
  ...prefixModule("generation", generationDe as Record<string, string>),
  ...prefixModule("practice", practiceDe as Record<string, string>),
  ...prefixModule("tools", toolsDe as Record<string, string>),
  ...prefixModule("grammar", grammarDe as Record<string, string>),
  ...prefixModule("workspace", workspaceDe as Record<string, string>),
  ...prefixModule("profile", profileDe as Record<string, string>)
});

/** Bundled fallback per language; English stays the ultimate fallback. */
export const bundledByLanguage: Partial<Record<string, Record<string, string>>> = Object.freeze({
  "bn-BD": bengaliDictionary,
  "de-DE": germanDictionary
});
