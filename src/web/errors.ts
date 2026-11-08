import { ApiError } from "./api.js";
import { t } from "./i18n/index.js";

/* One honest, human sentence per known failure shape, shared by every error
   surface (generate, practice, tools, dictionary, member ops). Known error
   codes get their own line so the UI never shows a raw stack; anything else
   keeps the server's own message. The canned lines come from the common
   dictionary, so they localize with everything else. */

export function describeApiError(err: unknown, fallback = t("common.error_generic")): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "rate_limited":
        return t("common.error_rate_limited");
      case "job_active":
        return t("common.error_job_active");
      case "no_language":
        return t("common.error_no_language");
      case "dictionary_empty":
        return t("common.error_dictionary_empty");
      case "not_found":
        return t("common.error_not_found");
      case "forbidden":
        return t("common.error_forbidden");
      case "provider_not_configured":
        return t("common.error_provider");
      default:
        return err.message || fallback;
    }
  }
  // Network-layer failures (fetch/OIDC renewal) surface as TypeError.
  if (err instanceof TypeError) {
    return t("common.error_network");
  }
  return err instanceof Error && err.message ? err.message : fallback;
}
