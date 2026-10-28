import { HttpError } from "../lib/http.js";

export { HttpError };

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, message, "bad_request", details);
export const unauthorized = (message = "Please sign in to continue") =>
  new HttpError(401, message, "unauthorized");
export const forbidden = (message = "You do not have permission to do that") =>
  new HttpError(403, message, "forbidden");
export const notFound = (message = "Not found") => new HttpError(404, message, "not_found");
export const conflict = (message: string, details?: unknown) =>
  new HttpError(409, message, "conflict", details);
export const tooMany = (message = "Too many requests. Please try again shortly.") =>
  new HttpError(429, message, "rate_limited");
