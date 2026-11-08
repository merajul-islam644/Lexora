import { Languages } from "lucide-react";
import { Select } from "../ui.js";
import { t } from "./index.js";
import { useI18n } from "./LocalizationProvider.js";

/* The language switcher — one component, mounted in both topbars (public
   header and the signed-in app topbar). Lists the languages configured on
   the Blocks tenant (fetched at runtime by the provider), so portal-side
   language changes appear here without a redeploy; before that list loads
   it shows the bundled boot list. */
export function LanguageSwitcher() {
  const { language, languages, setLanguage } = useI18n();
  return (
    <span className="lang-switch">
      <Languages size={14} aria-hidden="true" />
      <Select
        value={language}
        onChange={(v) => setLanguage(v)}
        aria-label={t("common.language")}
        className="lang-switch-select"
      >
        {languages.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </Select>
    </span>
  );
}
