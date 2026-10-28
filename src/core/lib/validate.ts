import { badRequest } from "./errors.js";
import type { ZodType } from "zod";

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw badRequest("Please check the highlighted fields", result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message
    })));
  }
  return result.data;
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
