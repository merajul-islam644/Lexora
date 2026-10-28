import { uid, nowIso } from "../db/ids.js";
import type { DataStore } from "../db/store.js";

export interface ActivityInput {
  workspaceId: string;
  actorUserId: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

/** Audit/activity trail. Never store sensitive full text in metadata (spec §15). */
export async function logActivity(store: DataStore, input: ActivityInput): Promise<void> {
  await store.insertActivity({
    id: uid(),
    workspace_id: input.workspaceId,
    actor_user_id: input.actorUserId,
    action: input.action,
    resource_type: input.resourceType ?? "",
    resource_id: input.resourceId ?? "",
    metadata_json: JSON.stringify(input.metadata ?? {}),
    created_at: nowIso()
  });
}
