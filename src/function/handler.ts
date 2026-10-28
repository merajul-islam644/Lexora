import { createBlocksClient } from "@seliseblocks/client";
import { blocksStore } from "../core/db/blocksStore.js";
import { HttpError, unauthorized } from "../core/lib/errors.js";
import { env } from "./env.js";
import {
  flatQuery,
  httpErrorAnswer,
  isHttpError,
  type ApiDeps,
  type ApiRequest,
  type ApiResponse,
} from "./support.js";
import * as workspaces from "./routes/workspaces.js";

/* lexora-api -- the SPA's remaining server-side surface. ALL schema data now
   flows browser -> Data Gateway directly (src/web/api.ts, the caller's own
   token); this function keeps ONLY the avatar endpoints, because storage
   presign/download/trash must run on the function's own identity -- the
   caller's token carries no storage permissions.

     input.path    e.g. "me/avatar/upload-url". Query arrives separately.
     input.method  GET/POST/PATCH/DELETE (trigger allow-list).
     ctx.context   the caller's Blocks identity (never trusted beyond "is
                   signed in").
     ctx.blocks    caller token for identity resolution and Data calls. */

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
  context: {
    userId?: string | null;
    isAuthenticated?: boolean;
    tenantId?: string;
  };
  blocks: { getAccessToken: () => Promise<string | undefined> };
  log: {
    info: (m: string, d?: unknown) => void;
    error: (m: string, d?: unknown) => void;
  };
}

export default async function handler(
  input: FnInput,
  ctx: FnContext,
): Promise<ApiResponse> {
  const token = await ctx.blocks.getAccessToken();
  const client = createBlocksClient({
    apiUrl: env.apiUrl,
    xBlocksKey: env.xBlocksKey,
    accessToken: token,
  });
  const deps: ApiDeps = {
    store: blocksStore(() => client),
    files: client.data.files,
  };

  try {
    // Identity: the email IAM attests for the caller's own token. The avatar
    // pointer (UserProfile) keys on it.
    let userEmail = "";
    try {
      const claims = (await client.auth.userInfo()) as
        | Record<string, unknown>
        | undefined;
      userEmail = String(
        (claims?.email as string) ??
          (claims?.preferred_username as string) ??
          "",
      )
        .trim()
        .toLowerCase();
    } catch {
      userEmail = "";
    }
    if (!userEmail) throw unauthorized("Please sign in to continue");

    const req: ApiRequest = {
      method: String(input.method ?? "GET").toUpperCase(),
      segments: String(input.path ?? "")
        .replace(/^\/+/, "")
        .split("/")
        .filter(Boolean),
      query: flatQuery(input.query),
      body: input.body,
      userEmail,
    };
    return await route(deps, req);
  } catch (err) {
    if (isHttpError(err)) return httpErrorAnswer(err);
    ctx.log.error("unhandled error", {
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      statusCode: 500,
      body: {
        error: {
          code: "internal",
          message: "Something went wrong on our side. Please try again.",
        },
      },
    };
  }
}

/* The API surface proper: avatar routes only. Exported so the tests can drive
   it directly with an in-memory store and an explicit caller email. */
export async function route(
  deps: ApiDeps,
  req: ApiRequest,
): Promise<ApiResponse> {
  const [head, second] = req.segments;
  const rest = req.segments.slice(1);

  if (head === "me" && second === "avatar" && rest[1] === "upload-url") {
    if (req.method === "POST") return workspaces.createAvatarUploadUrl(deps, req);
    throw methodNotAllowed();
  }

  if (head === "me" && second === "avatar") {
    if (req.method === "GET") return workspaces.getAvatar(deps, req);
    if (req.method === "PATCH") return workspaces.setAvatar(deps, req);
    if (req.method === "DELETE") return workspaces.deleteAvatar(deps, req);
    throw methodNotAllowed();
  }

  // Everything else lives in the browser now.
  throw notFoundRoute();
}

const notFoundRoute = () =>
  new HttpError(404, "API route not found", "not_found");
const methodNotAllowed = () =>
  new HttpError(405, "Method not allowed for this route", "method_not_allowed");
