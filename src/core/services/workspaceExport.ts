import type { DataStore, ActivityRow, MembershipRow, PhraseRow, VersionRow } from "../db/store.js";
import type { EntryRow, JobRow, LanguageRow } from "../db/rows.js";
import { getProfile } from "./translation.js";
import type { LanguageProfile } from "../../shared/schemas.js";

/* Full-workspace export (backup + portability, design.md §14): every
   collection of one workspace in a single JSON envelope. This is the app's
   only backup mechanism today -- the gateway keeps no point-in-time copies --
   so the Settings page labels it honestly. Restore is a manual, ops-level
   job (docs/known-gaps.md). */

export interface WorkspaceExportEnvelope {
  format: "lexora-workspace-export/v1";
  exportedAt: string;
  exportedBy: string;
  workspace: {
    id: string;
    name: string;
    organizationId: string;
    isDemo: boolean;
    createdAt: string;
  };
  members: MembershipRow[];
  language: {
    id: string;
    name: string;
    nativeName: string;
    description: string;
    status: string;
    version: number;
    createdAt: string;
    updatedAt: string;
    profile: LanguageProfile;
  } | null;
  versions: VersionRow[];
  entries: EntryRow[];
  phrasebook: PhraseRow[];
  jobs: JobRow[];
  activity: ActivityRow[];
  counts: {
    members: number;
    versions: number;
    entries: number;
    phrasebook: number;
    jobs: number;
    activity: number;
  };
}

/** Activity can exceed one page; walk pages until the store runs dry. */
async function listAllActivity(
  store: DataStore,
  workspaceId: string,
): Promise<ActivityRow[]> {
  const out: ActivityRow[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { rows } = await store.listActivity(workspaceId, pageSize, offset);
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}

export async function buildWorkspaceExport(
  store: DataStore,
  workspaceId: string,
  exportedBy: string,
): Promise<{ filename: string; contentType: string; content: string; counts: WorkspaceExportEnvelope["counts"] }> {
  const workspace = await store.getWorkspace(workspaceId);
  if (!workspace) throw new Error("Workspace not found");

  const language = await store.getLanguageByWorkspace(workspaceId);
  const profile = language ? getProfile(language) : null;
  const languageId = language?.id ?? null;

  const [members, versions, entries, phrasebook, jobs, activity] = await Promise.all([
    store.listMemberships(workspaceId),
    languageId ? store.listVersions(languageId) : Promise.resolve<VersionRow[]>([]),
    store.findEntries(workspaceId, { includeArchived: true }),
    store.listPhrasebook(workspaceId, 10_000),
    store.listJobs(workspaceId),
    listAllActivity(store, workspaceId),
  ]);

  const envelope: WorkspaceExportEnvelope = {
    format: "lexora-workspace-export/v1",
    exportedAt: new Date().toISOString(),
    exportedBy,
    workspace: {
      id: workspace.id,
      name: workspace.name,
      organizationId: workspace.organization_id,
      isDemo: workspace.is_demo === 1,
      createdAt: workspace.created_at,
    },
    members,
    language:
      language && profile
        ? {
            id: language.id,
            name: language.name,
            nativeName: profile.nativeName,
            description: language.description,
            status: language.status,
            version: language.version,
            createdAt: language.created_at,
            updatedAt: language.updated_at,
            profile,
          }
        : null,
    versions,
    entries,
    phrasebook,
    jobs,
    activity,
    counts: {
      members: members.length,
      versions: versions.length,
      entries: entries.length,
      phrasebook: phrasebook.length,
      jobs: jobs.length,
      activity: activity.length,
    },
  };

  return {
    filename: `lexora-${workspace.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workspace"}-${envelope.exportedAt.slice(0, 10)}.json`,
    contentType: "application/json",
    content: JSON.stringify(envelope, null, 2),
    counts: envelope.counts,
  };
}
