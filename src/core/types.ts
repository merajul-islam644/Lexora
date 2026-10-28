import type { WorkspaceRole } from "../shared/schemas.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
      cookies: Record<string, string>;
      auth?: { userId: string; email: string; emailVerified: boolean; sessionId: string };
      membership?: { workspaceId: string; role: WorkspaceRole };
    }
  }
}

export const ROLE_RANK: Record<WorkspaceRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4
};

export function hasAtLeast(role: WorkspaceRole, min: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** Actions each role may perform. Enforced server-side (spec §14). */
export const PERMISSIONS = {
  "dictionary:read": "viewer",
  "dictionary:write": "editor",
  "dictionary:import": "editor",
  "dictionary:export": "viewer",
  "language:generate": "editor",
  "language:rename": "editor",
  "language:restore": "admin",
  "members:manage": "admin",
  "workspace:delete": "owner",
  "workspace:rename": "admin"
} as const satisfies Record<string, WorkspaceRole>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: WorkspaceRole, permission: Permission): boolean {
  return hasAtLeast(role, PERMISSIONS[permission]);
}
