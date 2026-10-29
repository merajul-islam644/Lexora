import { api, type PublicUser, type WorkspaceSummary } from "../api.js";

/* Loads the app session straight from the Gateway-backed data layer. There is
   no local account to bridge into: identity comes from the signed-in user's
   own Blocks token (GET /me resolves it from the IAM claims). Returns the
   same shape as GET /me so callers can seed SessionProvider. */
export async function loadSession(): Promise<{
  user: PublicUser;
  workspaces: WorkspaceSummary[];
  organizations: Array<{ id: string; name: string }>;
}> {
  return api.get<{
    user: PublicUser;
    workspaces: WorkspaceSummary[];
    organizations: Array<{ id: string; name: string }>;
  }>("/api/me");
}
