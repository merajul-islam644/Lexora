import { ApiError } from "./api.js";

/* One honest, human sentence per known failure shape, shared by every error
   surface (generate, practice, tools, dictionary, member ops). Known error
   codes get their own line so the UI never shows a raw stack; anything else
   keeps the server's own message. */

export function describeApiError(err: unknown, fallback = "That didn't work. Please try again."): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "rate_limited":
        return "Hold on a moment — try again in about 30 seconds. (This cooldown is an in-browser safeguard, not a server quota.)";
      case "job_active":
        return "A generation is already running for this workspace. Wait for it to finish, or cancel it first.";
      case "no_language":
        return "Generate your language first — this tool coins words using your language's own sound and derivation rules.";
      case "dictionary_empty":
        return "Your dictionary is empty. Add or import words first, or start with the starter dictionary.";
      case "not_found":
        return "Not found — it may have been deleted, or you may not have access to it.";
      case "forbidden":
        return "Your role in this workspace doesn't allow that.";
      case "provider_not_configured":
        return "Generation is not configured right now. Please try again later.";
      default:
        return err.message || fallback;
    }
  }
  // Network-layer failures (fetch/OIDC renewal) surface as TypeError.
  if (err instanceof TypeError) {
    return "Network problem — check your connection, sign in again, and retry.";
  }
  return err instanceof Error && err.message ? err.message : fallback;
}
