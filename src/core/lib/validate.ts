import { badRequest } from "./errors.js";
import type { ZodType, output as ZodOutput } from "zod";

// S extends ZodType + z.output<S> (instead of ZodType<T>) so the parsed type
// infers under every moduleResolution setting, including the web "Bundler"
// one where ZodType<T> inference degrades to unknown.
export function parseBody<S extends ZodType>(
  schema: S,
  body: unknown,
): ZodOutput<S> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw badRequest("Please check the highlighted fields", result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message
    })));
  }
  return result.data as ZodOutput<S>;
}

export function pageParams(query: Record<string, unknown>, defaultPageSize = 20, maxPageSize = 100): {
  page: number;
  pageSize: number;
  offset: number;
} {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(maxPageSize, Math.max(1, Number(query.pageSize) || defaultPageSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
