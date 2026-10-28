import { api, type PublicUser, type WorkspaceSummary } from "../api.js";

/* Loads the app session from the lexora-api function. There is no local
   account to bridge into anymore: identity comes from the signed-in user's
   own Blocks token, which the function resolves server-side (GET /me).
   Returns the same shape as GET /me so callers can seed SessionProvider. */
export async function loadSession(): Promise<{ user: PublicUser; workspaces: WorkspaceSummary[] }> {
  return api.get<{ user: PublicUser; workspaces: WorkspaceSummary[] }>("/api/me");
}
