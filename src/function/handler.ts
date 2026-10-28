import { createBlocksClient } from "@seliseblocks/client";
import { blocksStore } from "../core/db/blocksStore.js";
import { HttpError, unauthorized } from "../core/lib/errors.js";
import { env } from "./env.js";
import { flatQuery, httpErrorAnswer, isHttpError, requireWorkspace, type ApiDeps, type ApiRequest, type ApiResponse } from "./support.js";
import * as workspaces from "./routes/workspaces.js";
import * as dictionary from "./routes/dictionary.js";
import * as language from "./routes/language.js";
import * as tools from "./routes/tools.js";

/* lexora-api -- the whole backend as one Blocks Function. The SPA calls it
   through the SDK (blocksClient.logic.functions.invoke) with its own hosted-
   login session; this handler replaces the Express server:

     input.path    e.g. "ws/<id>/dictionary?...". Query arrives separately.
     input.method  GET/POST/PATCH/DELETE (trigger allow-list).
     ctx.context   the caller's Blocks identity (never trusted beyond "is
                   signed in"); the caller's email -- resolved from IAM with
                   the caller's own token -- keys memberships and ownership.
     ctx.blocks    caller token for Data Gateway calls as that user.

   Authorization is enforced here per route (tenant guard + permission), the
   same contract the Express middleware provided (spec §14). */

/* Minimal structural mirrors of the platform's FunctionInput/FunctionContext
   (importing them from the SDK's /functions subpath is unnecessary for a
   bundle that only reads these fields). */
interface FnInput {
  method?: string;
  path?: string;
  query?: Record<string, unknown>;
  body?: unknown;
}
interface FnContext {
  context: { userId?: string | null; isAuthenticated?: boolean; tenantId?: string };
  blocks: { getAccessToken: () => Promise<string | undefined> };
  log: { info: (m: string, d?: unknown) => void; error: (m: string, d?: unknown) => void };
  waitUntil: (promise: Promise<unknown>) => void;
}

export default async function handler(input: FnInput, ctx: FnContext): Promise<ApiResponse> {
  const token = await ctx.blocks.getAccessToken();
  const client = createBlocksClient({
    apiUrl: env.apiUrl,
    xBlocksKey: env.xBlocksKey,
    accessToken: token
  });
  const deps: ApiDeps = {
    store: blocksStore(() => client),
    schedule: (promise) => ctx.waitUntil(promise)
  };

  try {
    // Identity: the email IAM attests for the caller's own token. Everything
    // downstream (memberships, ownership, activity actors) keys on it.
    let userEmail = "";
    try {
      const claims = (await client.auth.userInfo()) as Record<string, unknown> | undefined;
      userEmail = String((claims?.email as string) ?? (claims?.preferred_username as string) ?? "")
        .trim()
        .toLowerCase();
    } catch {
      userEmail = "";
    }
    if (!userEmail) throw unauthorized("Please sign in to continue");

    const req: ApiRequest = {
      method: String(input.method ?? "GET").toUpperCase(),
      segments: String(input.path ?? "").replace(/^\/+/, "").split("/").filter(Boolean),
      query: flatQuery(input.query),
      body: input.body,
      userEmail
    };
    return await route(deps, req);
  } catch (err) {
    if (isHttpError(err)) return httpErrorAnswer(err);
    ctx.log.error("unhandled error", { message: err instanceof Error ? err.message : String(err) });
    return {
      statusCode: 500,
      body: { error: { code: "internal", message: "Something went wrong on our side. Please try again." } }
    };
  }
}

/* The API surface proper: routing + per-route authorization, no identity or
   transport. Exported so the tests can drive it directly with an in-memory
   store and an explicit caller email (identity lives in the handler above). */
export async function route(deps: ApiDeps, req: ApiRequest): Promise<ApiResponse> {
  const [head, second] = req.segments;
  const rest = req.segments.slice(1);

  if (head === "me" && rest.length === 0 && req.method === "GET") {
    return workspaces.getMe(deps, req);
  }

  if (head === "workspaces" && rest.length === 0) {
    if (req.method === "GET") return workspaces.listWorkspaces(deps, req);
    if (req.method === "POST") return workspaces.createWorkspace(deps, req);
    throw methodNotAllowed();
  }

  if (head === "ws" && second) {
    return routeWorkspace(deps, req, second, req.segments.slice(2));
  }

  throw notFoundRoute();
}

async function routeWorkspace(deps: ApiDeps, req: ApiRequest, workspaceId: string, segs: string[]): Promise<ApiResponse> {
  const [family, a, b, c] = segs;
  const tenant = "viewer" as const;

  // Tenant guard for everything under /ws/:id (404 for non-members).
  const role = await requireWorkspace(deps, workspaceId, req.userEmail, tenant);

  if (segs.length === 0) {
    if (req.method === "GET") return workspaces.getWorkspace(deps, req, workspaceId, role);
    if (req.method === "PATCH") return workspaces.renameWorkspace(deps, req, workspaceId);
    if (req.method === "DELETE") return workspaces.deleteWorkspace(deps, req, workspaceId);
    throw methodNotAllowed();
  }

  switch (family) {
    case "dashboard":
      return workspaces.getDashboard(deps, req, workspaceId, role);
    case "activity":
      return workspaces.getActivity(deps, req, workspaceId);
    case "security":
      return workspaces.getSecurity(deps, req, workspaceId);
    case "members":
      if (segs.length === 1 && req.method === "GET") return workspaces.listMembers(deps, req, workspaceId);
      if (segs.length === 1 && req.method === "POST") return workspaces.addMember(deps, req, workspaceId);
      if (segs.length === 2 && a && req.method === "PATCH") return workspaces.updateMember(deps, req, workspaceId, a);
      if (segs.length === 2 && a && req.method === "DELETE") return workspaces.removeMember(deps, req, workspaceId, a);
      throw methodNotAllowed();
    case "dictionary":
      return dispatchDictionary(deps, req, workspaceId, segs.slice(1));
    case "language":
      return dispatchLanguage(deps, req, workspaceId, segs.slice(1));
    case "word-builder":
      if (a === "suggest" && req.method === "POST") return tools.suggestWordRoute(deps, req, workspaceId);
      if (a === "approve" && req.method === "POST") return tools.approveWord(deps, req, workspaceId);
      throw notFoundRoute();
    case "translate":
      if (req.method === "POST") return tools.translateRoute(deps, req, workspaceId);
      throw notFoundRoute();
    case "phrasebook":
      if (segs.length === 1 && req.method === "GET") return tools.listPhrasebook(deps, req, workspaceId);
      if (segs.length === 1 && req.method === "POST") return tools.addPhrase(deps, req, workspaceId);
      if (segs.length === 2 && a && req.method === "DELETE") return tools.removePhrase(deps, req, workspaceId, a);
      throw notFoundRoute();
    case "practice":
      if (a === "queue" && req.method === "GET") return tools.practiceQueue(deps, req, workspaceId);
      if (a === "review" && req.method === "POST") return tools.practiceReview(deps, req, workspaceId);
      if (a === "stats" && req.method === "GET") return tools.practiceStats(deps, req, workspaceId);
      throw notFoundRoute();
    default:
      throw notFoundRoute();
  }
  // `b`/`c` unused placeholder guards for future deeper routes.
  void b; void c;
}

async function dispatchDictionary(deps: ApiDeps, req: ApiRequest, workspaceId: string, segs: string[]): Promise<ApiResponse> {
  const [a, b, c] = segs;

  if (segs.length === 0) {
    if (req.method === "GET") return dictionary.listEntries(deps, req, workspaceId);
    if (req.method === "POST") return dictionary.createEntry(deps, req, workspaceId);
    throw methodNotAllowed();
  }
  // Explicit paths must win over :entryId.
  if (a === "template" && req.method === "GET") return dictionary.getTemplate();
  if (a === "export" && req.method === "GET") return dictionary.exportDictionary(deps, req, workspaceId);
  if (a === "import" && b === "preview" && req.method === "POST") return dictionary.importPreview(deps, req, workspaceId);
  if (a === "import" && b === "commit" && req.method === "POST") return dictionary.importCommit(deps, req, workspaceId);

  if (a) {
    if (b === "restore" && req.method === "POST") return dictionary.restoreEntry(deps, req, workspaceId, a);
    if (b === "history" && req.method === "GET") return dictionary.getHistory(deps, req, workspaceId, a);
    if (!b) {
      if (req.method === "GET") return dictionary.getEntry(deps, req, workspaceId, a);
      if (req.method === "PATCH") return dictionary.updateEntry(deps, req, workspaceId, a);
      if (req.method === "DELETE") return dictionary.archiveEntry(deps, req, workspaceId, a);
    }
  }
  void c;
  throw notFoundRoute();
}

async function dispatchLanguage(deps: ApiDeps, req: ApiRequest, workspaceId: string, segs: string[]): Promise<ApiResponse> {
  const [a, b, c] = segs;

  if (segs.length === 0) {
    if (req.method === "GET") return language.getLanguage(deps, req, workspaceId);
    if (req.method === "PATCH") return language.renameLanguage(deps, req, workspaceId);
    throw methodNotAllowed();
  }
  if (a === "generate" && req.method === "POST") return language.generate(deps, req, workspaceId);
  if (a === "grammar" && req.method === "GET") return language.getGrammar(deps, req, workspaceId);
  if (a === "versions" && segs.length === 1 && req.method === "GET") return language.listVersions(deps, req, workspaceId);
  if (a === "versions" && b && c === "restore" && req.method === "POST") return language.restoreVersion(deps, req, workspaceId, b);
  if (a === "jobs" && b) {
    if (!c && req.method === "GET") return language.getJobState(deps, req, workspaceId, b);
    if (c === "cancel" && req.method === "POST") return language.cancelJob(deps, req, workspaceId, b);
  }
  throw notFoundRoute();
}

const notFoundRoute = () => new HttpError(404, "API route not found", "not_found");
const methodNotAllowed = () => new HttpError(405, "Method not allowed for this route", "method_not_allowed");
