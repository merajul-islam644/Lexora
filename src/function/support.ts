import type { DataStore } from "../core/db/store.js";
import { HttpError, forbidden, notFound } from "../core/lib/errors.js";
import { hasAtLeast, can, type Permission } from "../core/types.js";
import type { WorkspaceRole } from "../shared/schemas.js";

/* Transport-level plumbing for the lexora-api Blocks Function: the request
   shape the router dispatches, response envelopes, and the tenant guard that
   replaces Express middleware. Identity here is the signed-in IAM account's
   lowercase email -- the same dev-stage trust model the old relay used
   (WorkspaceMembership.user_id stores that email). */

export interface ApiRequest {
  method: string;
  segments: string[];
  query: Record<string, string>;
  body: unknown;
  userEmail: string;
  /** IAM display name for the caller, when the token carries one; the /me
     route surfaces it for greetings. Optional so tests can omit it. */
  userDisplayName?: string;
}

export interface ApiResponse {
  statusCode: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** What route handlers get besides the request: the store plus a scheduler
 * for work that continues after the answer is sent (generation jobs). */
export interface ApiDeps {
  store: DataStore;
  schedule: (promise: Promise<unknown>) => void;
}

export const ok = (body?: unknown): ApiResponse => ({ statusCode: 200, body: body ?? {} });
export const created = (body: unknown): ApiResponse => ({ statusCode: 201, body });
export const accepted = (body: unknown): ApiResponse => ({ statusCode: 202, body });

/** Tenant guard. A missing membership answers 404 so workspaces cannot be
 * probed for existence; a role below the minimum (or lacking the permission)
 * answers 403. All checks run inside the function -- the browser is never
 * trusted to decide access. */
export async function requireWorkspace(
  deps: ApiDeps,
  workspaceId: string,
  userEmail: string,
  minRole: WorkspaceRole,
  permission?: Permission
): Promise<WorkspaceRole> {
  const row = await deps.store.getMembership(workspaceId, userEmail).catch(() => undefined);
  if (!row) throw notFound("Workspace not found");
  const role = row.role as WorkspaceRole;
  if (!hasAtLeast(role, minRole)) throw forbidden();
  if (permission && !can(role, permission)) throw forbidden();
  return role;
}

/** Flatten the function's query input (string | string[] | undefined) to the
 * single-value shape the route code expects. */
export function flatQuery(query: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(query ?? {})) {
    if (typeof v === "string") out[k] = v;
    else if (Array.isArray(v) && typeof v[0] === "string") out[k] = v[0];
  }
  return out;
}

export function httpErrorAnswer(err: HttpError): ApiResponse {
  return { statusCode: err.status, body: { error: { code: err.code, message: err.message, details: err.details } } };
}

export function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError;
}
