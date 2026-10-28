import { parseBody } from "../../core/lib/validate.js";
import { avatarSchema, avatarUploadSchema } from "../../shared/schemas.js";
import { badRequest } from "../../core/lib/errors.js";
import type { ApiDeps, ApiRequest, ApiResponse } from "../support.js";
import { created, ok } from "../support.js";

/* Avatar domain -- the function's ONLY remaining surface. Storage presign,
   download URLs and file trash run here because the caller's token carries no
   storage permissions; every other route moved browser-side (src/web/api.ts). */

/** Storage configuration backing avatar files. Private access; only the
    function's identity touches it. */
const AVATAR_STORAGE_CONFIG = "Default";

/** GET me/avatar -- the caller's avatar: the Blocks Data file id plus a fresh
    short-lived download URL. The download URL is resolved HERE, with the
    function's identity; download URLs expire, so this is re-fetched per page
    load. */
export async function getAvatar(deps: ApiDeps, req: ApiRequest): Promise<ApiResponse> {
  const fileId = await deps.store.getAvatarFileId(req.userEmail);
  if (!fileId) return ok({ fileId: null, downloadUrl: null });
  try {
    const res = await deps.files.get(fileId, { configurationName: AVATAR_STORAGE_CONFIG });
    return ok({ fileId, downloadUrl: pickFileUrl(res) });
  } catch {
    return ok({ fileId, downloadUrl: null });
  }
}

/** Storage file extension per accepted image type -- presign requires a
    name with an allowed extension (blocks-data-storage skill). */
const AVATAR_EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;

/** POST me/avatar/upload-url -- pre-signed upload URL, created with the
    function's identity. Returns { uploadUrl, fileId, requiredHeaders }; the
    SPA PUTs the bytes straight to Azure (with those headers) and then PATCHes
    the pointer. Private access modifier, 5 MB cap enforced client-side. */
export async function createAvatarUploadUrl(deps: ApiDeps, req: ApiRequest): Promise<ApiResponse> {
  const body = parseBody(avatarUploadSchema, req.body);
  // Storage errors carry the gateway's own reason (BlocksApiError.message) —
  // surface it instead of the handler's blind 500 so failures diagnose themselves.
  let res: unknown;
  try {
    res = await deps.files.presignedUploadUrl({
      name: `avatar-${req.userEmail.split("@")[0]}-${Date.now()}.${AVATAR_EXTENSIONS[body.contentType]}`,
      configurationName: AVATAR_STORAGE_CONFIG,
      accessModifier: "Private",
      contentType: body.contentType
    });
  } catch (e) {
    const reason = e instanceof Error && e.message ? e.message : "unknown storage error";
    throw badRequest(`Storage presign failed: ${reason.slice(0, 300)}. Please try again.`);
  }
  const found = extractPresign(res);
  if (!found.uploadUrl || !found.fileId) {
    throw badRequest(`Storage presign failed: ${describePresignFailure(res)}. Please try again.`);
  }
  return created({ uploadUrl: found.uploadUrl, fileId: found.fileId, requiredHeaders: found.requiredHeaders ?? {} });
}

/** The presign payload has appeared top-level and nested under `data` on
    different endpoints — walk a few levels and take the fields by name,
    including the requiredHeaders the provider expects on the PUT. */
function extractPresign(res: unknown, depth = 0): {
  uploadUrl?: string;
  fileId?: string;
  requiredHeaders?: Record<string, string>;
} {
  if (!res || typeof res !== "object" || depth > 3) return {};
  const out: { uploadUrl?: string; fileId?: string; requiredHeaders?: Record<string, string> } = {};
  for (const [key, value] of Object.entries(res as Record<string, unknown>)) {
    if (typeof value === "string") {
      if ((key === "uploadUrl" || key === "preSignedUrl" || key === "url") && !out.uploadUrl) out.uploadUrl = value;
      if (key === "fileId" && !out.fileId) out.fileId = value;
    } else if (value && typeof value === "object") {
      if (key === "requiredHeaders" && !out.requiredHeaders) {
        const entries = Object.entries(value as Record<string, unknown>).flatMap(([name, v]) =>
          typeof v === "string" ? [[name, v] as const] : []
        );
        if (entries.length > 0) out.requiredHeaders = Object.fromEntries(entries);
      }
      const nested = extractPresign(value, depth + 1);
      out.uploadUrl = out.uploadUrl ?? nested.uploadUrl;
      out.fileId = out.fileId ?? nested.fileId;
      out.requiredHeaders = out.requiredHeaders ?? nested.requiredHeaders;
    }
  }
  return out;
}

/** Human-readable reason from a failed presign envelope: the gateway's own
    `errors` when isSuccess=false, otherwise the top-level keys (the envelope
    shape has drifted before) — never the signed values themselves. */
function describePresignFailure(res: unknown): string {
  if (!res || typeof res !== "object") return "empty storage response";
  const r = res as Record<string, unknown>;
  if (r.isSuccess === false && r.errors) {
    const detail = typeof r.errors === "string" ? r.errors : JSON.stringify(r.errors);
    if (detail && detail !== "{}") return detail.slice(0, 300);
  }
  const keys = Object.keys(r).join(", ");
  return `unrecognized response (keys: ${keys || "none"})`;
}

/** PATCH me/avatar -- store the file id of the caller's freshly uploaded
    avatar, trashing the previous file (best-effort). */
export async function setAvatar(deps: ApiDeps, req: ApiRequest): Promise<ApiResponse> {
  const body = parseBody(avatarSchema, req.body);
  const fileId = body.fileId.trim();
  const previousFileId = await deps.store.getAvatarFileId(req.userEmail);
  await deps.store.setAvatarFileId(req.userEmail, fileId);
  if (previousFileId && previousFileId !== fileId) {
    await deps.files.delete({ fileId: previousFileId, permanent: false }).catch(() => undefined);
  }
  return ok({ fileId });
}

/** DELETE me/avatar -- clear the pointer and trash the file (best-effort). */
export async function deleteAvatar(deps: ApiDeps, req: ApiRequest): Promise<ApiResponse> {
  const previousFileId = await deps.store.getAvatarFileId(req.userEmail);
  await deps.store.setAvatarFileId(req.userEmail, "");
  if (previousFileId) {
    await deps.files.delete({ fileId: previousFileId, permanent: false }).catch(() => undefined);
  }
  return ok({ fileId: null });
}

/** First URL-shaped field in the untyped files.get payload. */
function pickFileUrl(res: unknown): string | null {
  for (const cand of [(res as Record<string, unknown>)?.data, res]) {
    if (!cand || typeof cand !== "object") continue;
    for (const key of ["fileUrl", "downloadUrl", "url", "presignedUrl", "link"]) {
      const v = (cand as Record<string, unknown>)[key];
      if (typeof v === "string" && v) return v;
    }
  }
  return null;
}
