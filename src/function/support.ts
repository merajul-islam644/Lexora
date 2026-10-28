import type { DataStore } from "../core/db/store.js";
import { HttpError } from "../core/lib/errors.js";

/* Transport-level plumbing for the lexora-api Blocks Function: the request
   shape the router dispatches and response envelopes. Identity is the
   signed-in IAM account's lowercase email (WorkspaceMembership.user_id stores
   that email). The function's only routes are the avatar endpoints -- tenant
   and permission guards live browser-side in src/web/api.ts now. */

import type { BlocksClient } from "@seliseblocks/client";

export interface ApiRequest {
  method: string;
  segments: string[];
  query: Record<string, string>;
  body: unknown;
  userEmail: string;
}

export interface ApiResponse {
  statusCode: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** What route handlers get besides the request. `files` is the Blocks Data
 * files API on the function's own identity — the caller's token carries no
 * storage permissions, so every storage call runs here. */
export interface ApiDeps {
  store: DataStore;
  files: BlocksClient["data"]["files"];
}

export const ok = (body?: unknown): ApiResponse => ({ statusCode: 200, body: body ?? {} });
export const created = (body: unknown): ApiResponse => ({ statusCode: 201, body });

/** Flatten the function's query input (string | string[] | undefined) to the
   single-value shape the route code expects. */
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
