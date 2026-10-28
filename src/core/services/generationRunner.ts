import { uid, nowIso, normalizeWord } from "../db/ids.js";
import {
  GENERATION_STAGES,
  GenerationEngine,
  type StageId,
} from "./generator/index.js";
import { getProvider } from "./generator/provider.js";
import {
  generateNameCandidate,
  buildPhonology,
  mulberry32,
  hashSeed,
  toIpa,
} from "./generator/core.js";
import { logActivity } from "./activity.js";
import { HttpError } from "../lib/http.js";
import type { JobRow, EntryRow, LanguageRow } from "../db/rows.js";
import type { DataStore } from "../db/store.js";
import type {
  LanguageProfile,
  GenStyle,
  ReferenceLangs,
} from "../../shared/schemas.js";

const JOB_TIMEOUT_MS = 90_000;

export interface StageState {
  id: StageId;
  label: string;
  labelBn: string;
  status: "pending" | "running" | "done";
}

export interface JobResult {
  languageId: string;
  name: string;
  nativeName: string;
  version: number;
  wordCount: number;
  rulesCount: number;
  generatedDrafts: number;
  warnings: string[];
}

export async function createGenerationJob(
  store: DataStore,
  params: {
    workspaceId: string;
    userId: string;
    style: GenStyle;
    referenceLangs: ReferenceLangs;
    preferredName?: string;
  },
): Promise<JobRow> {
  const active = await store.getActiveJob(params.workspaceId);
  if (active) {
    throw new HttpError(
      409,
      "A language generation is already running for this workspace. Wait for it to finish or cancel it.",
      "job_active",
    );
  }
  const id = uid();
  const now = nowIso();
  const stages = GENERATION_STAGES.map(
    (s) =>
      ({
        id: s.id,
        label: s.label,
        labelBn: s.labelBn,
        status: "pending",
      }) satisfies StageState,
  );
  const row: JobRow = {
    id,
    workspace_id: params.workspaceId,
    user_id: params.userId,
    status: "queued",
    stages_json: JSON.stringify(stages),
    result_json: null,
    error: null,
    style: params.style,
    reference_langs: params.referenceLangs,
    preferred_name: params.preferredName ?? null,
    created_at: now,
    updated_at: now,
    finished_at: null,
  };
  await store.insertJob(row);
  return row;
}

export async function getJob(store: DataStore, jobId: string): Promise<JobRow> {
  const job = await store.getJob(jobId);
  if (!job) throw new HttpError(404, "Job not found", "not_found");
  return job;
}

export async function cancelGenerationJob(
  store: DataStore,
  jobId: string,
  workspaceId: string,
): Promise<JobRow> {
  const job = await getJob(store, jobId);
  if (!job || job.workspace_id !== workspaceId)
    throw new HttpError(404, "Job not found", "not_found");
  if (job.status === "queued" || job.status === "running") {
    const now = nowIso();
    await store.updateJob(jobId, {
      status: "cancelled",
      finished_at: now,
      updated_at: now,
    });
  }
  return getJob(store, jobId);
}

async function setJobStatus(
  store: DataStore,
  jobId: string,
  status: JobRow["status"],
  patch: { error?: string; result?: JobResult } = {},
): Promise<void> {
  await store.updateJob(jobId, {
    status,
    error: patch.error ?? null,
    result_json: patch.result ? JSON.stringify(patch.result) : null,
    updated_at: nowIso(),
    finished_at: ["completed", "failed", "cancelled", "timeout"].includes(
      status,
    )
      ? nowIso()
      : null,
  });
}

async function setStage(
  store: DataStore,
  jobId: string,
  stageId: StageId,
  status: StageState["status"],
): Promise<void> {
  const job = await getJob(store, jobId);
  const stages = JSON.parse(job.stages_json) as StageState[];
  const stage = stages.find((s) => s.id === stageId);
  if (stage) stage.status = status;
  await store.updateJob(jobId, {
    stages_json: JSON.stringify(stages),
    updated_at: nowIso(),
  });
}

async function jobIsCancelled(
  store: DataStore,
  jobId: string,
): Promise<boolean> {
  const job = await getJob(store, jobId);
  return job.status === "cancelled";
}

export class JobTimeoutError extends Error {}

/**
 * Runs a generation job: real stages, persisted between steps so the UI can
 * poll honest progress. No percentages, and success is only recorded after the
 * result is committed (spec §8, §17).
 */
export async function runGenerationJob(
  store: DataStore,
  jobId: string,
): Promise<void> {
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  const checkGate = async (): Promise<void> => {
    if (await jobIsCancelled(store, jobId)) throw new CancelledError();
    if (Date.now() > deadline) throw new JobTimeoutError();
  };

  try {
    const job = await getJob(store, jobId);
    await setJobStatus(store, jobId, "running");

    const workspace = await store.getWorkspace(job.workspace_id);
    const entries = await store.findEntries(job.workspace_id);
    const existingNames = new Set(await store.listLanguageNormalizedNames());
    const existingWords = new Set(
      (
        await store.findEntries(job.workspace_id, { includeArchived: true })
      ).map((r) => r.normalized_word),
    );

    const previousLanguage = await store.getLanguageByWorkspace(
      job.workspace_id,
    );

    const input = {
      workspaceName: workspace?.name ?? "workspace",
      entries,
      style: job.style as GenStyle,
      referenceLangs: job.reference_langs as ReferenceLangs,
      existingNames,
      existingWords,
      preferredName: job.preferred_name ?? undefined,
      seed: hashSeed(`${job.workspace_id}:${job.id}:${job.created_at}`),
      version: previousLanguage ? previousLanguage.version + 1 : 1,
    };

    const provider = getProvider();
    if (!provider.isConfigured()) {
      throw new HttpError(
        503,
        "The generation provider is not configured on this server.",
        "provider_not_configured",
      );
    }

    let profile: LanguageProfile;
    if (provider.name === "local-deterministic") {
      const engine = new GenerationEngine(input);
      for (const stage of GENERATION_STAGES) {
        if (stage.id === "saving") break;
        await checkGate();
        await setStage(store, jobId, stage.id, "running");
        engine.runStage(stage.id);
        await setStage(store, jobId, stage.id, "done");
      }
      await checkGate();
      profile = engine.buildProfile();
    } else {
      for (const stage of GENERATION_STAGES) {
        if (stage.id === "saving") break;
        await checkGate();
        await setStage(store, jobId, stage.id, "running");
      }
      profile = await provider.generate(input, (stage) => {
        void setStage(store, jobId, stage, "done");
      });
    }

    await checkGate();
    await setStage(store, jobId, "saving", "running");

    const saved = await persistLanguage(store, {
      workspaceId: job.workspace_id,
      userId: job.user_id,
      profile,
      previous: previousLanguage,
      input,
    });

    await setStage(store, jobId, "saving", "done");

    const result: JobResult = {
      languageId: saved.languageId,
      name: saved.name,
      nativeName: profile.nativeName,
      version: saved.version,
      wordCount: profile.vocabulary.length,
      rulesCount: profile.grammarRules.length,
      generatedDrafts: saved.generatedDrafts,
      warnings: profile.consistencyWarnings,
    };

    await logActivity(store, {
      workspaceId: job.workspace_id,
      actorUserId: job.user_id,
      action: previousLanguage ? "language.regenerated" : "language.created",
      resourceType: "language",
      resourceId: saved.languageId,
      metadata: { name: saved.name, version: saved.version },
    });

    await setJobStatus(store, jobId, "completed", { result });
  } catch (err) {
    if (err instanceof CancelledError) {
      await setJobStatus(store, jobId, "cancelled", {
        error: "Generation was cancelled.",
      });
      return;
    }
    if (err instanceof JobTimeoutError) {
      await setJobStatus(store, jobId, "timeout", {
        error:
          "Generation took too long and was stopped. Nothing was saved — you can retry.",
      });
      return;
    }
    if (err instanceof HttpError) {
      await setJobStatus(store, jobId, "failed", { error: err.message });
      return;
    }
    await setJobStatus(store, jobId, "failed", {
      error:
        "Generation failed unexpectedly. Nothing was saved — you can retry.",
    });
  }
}

class CancelledError extends Error {}

async function persistLanguage(
  store: DataStore,
  params: {
    workspaceId: string;
    userId: string;
    profile: LanguageProfile;
    previous: LanguageRow | undefined;
    input: {
      existingNames: ReadonlySet<string>;
      style: GenStyle;
      referenceLangs: ReferenceLangs;
      seed: number;
      workspaceName: string;
      entries: EntryRow[];
      preferredName?: string;
    };
  },
): Promise<{
  languageId: string;
  version: number;
  name: string;
  generatedDrafts: number;
}> {
  const existingNames = new Set(params.input.existingNames);
  let name = params.profile.name;
  let nativeName = params.profile.nativeName;

  if (!params.previous) {
    // First generation: resolve a globally unique, case-insensitive name.
    const wanted = normalizeWord(name);
    if (existingNames.has(wanted)) {
      let resolved = false;
      for (let attempt = 1; attempt <= 50 && !resolved; attempt++) {
        const seed = (params.input.seed + attempt * 7919) >>> 0;
        const candidate = generateNameCandidate(
          mulberry32(seed),
          buildPhonology(mulberry32(seed ^ 0x1234), params.input.style),
          existingNames,
        );
        if (candidate) {
          const norm = normalizeWord(candidate.name);
          if (!existingNames.has(norm)) {
            name = candidate.name;
            nativeName = candidate.nativeName;
            existingNames.add(norm);
            resolved = true;
          }
        }
      }
      if (!resolved)
        throw new HttpError(
          503,
          "Could not find a free language name; please retry.",
          "duplicate_name",
        );
    } else {
      existingNames.add(wanted);
    }
  } else {
    // Regeneration keeps the language's identity; the name persists across versions.
    name = params.previous.name;
    nativeName = params.profile.nativeName || "";
  }

  const now = nowIso();
  let languageId: string;
  let version: number;
  if (params.previous) {
    languageId = params.previous.id;
    version = params.previous.version + 1;
    const stored = { ...params.profile, name, nativeName };
    await store.updateLanguage(languageId, {
      version,
      profile_json: JSON.stringify(stored),
      status: "active",
      updated_at: now,
    });
  } else {
    languageId = uid();
    version = 1;
    const stored = { ...params.profile, name, nativeName };
    await store.insertLanguage({
      id: languageId,
      workspace_id: params.workspaceId,
      name,
      normalized_name: normalizeWord(name),
      description: params.profile.description,
      status: "active",
      version,
      profile_json: JSON.stringify(stored),
      created_at: now,
      updated_at: now,
    });
  }

  await store.insertVersion({
    id: uid(),
    workspace_id: params.workspaceId,
    language_id: languageId,
    version,
    snapshot_json: JSON.stringify({ ...params.profile, name, nativeName }),
    change_summary: params.profile.versionSummary,
    created_by: params.userId,
    created_at: now,
  });

  // Link the user's entries to this language (idempotent).
  await store.linkEntriesToLanguage(params.workspaceId, languageId);

  // Insert generated words as DRAFT entries, clearly distinguished from the user's.
  let generatedDrafts = 0;
  const existingWords = new Set(
    (
      await store.findEntries(params.workspaceId, { includeArchived: true })
    ).map((r) => r.normalized_word),
  );
  for (const item of params.profile.vocabulary) {
    if (item.source !== "generated" || item.entryId) continue;
    const norm = normalizeWord(item.word);
    if (existingWords.has(norm)) continue;
    existingWords.add(norm);
    await store.insertEntry({
      id: uid(),
      workspace_id: params.workspaceId,
      language_id: languageId,
      word: item.word,
      normalized_word: norm,
      bengali_meaning: item.bengaliMeaning,
      english_meaning: item.englishMeaning,
      pronunciation_guide: item.pronunciationGuide,
      ipa: toIpa(item.word),
      part_of_speech: item.partOfSpeech,
      root: item.root,
      word_formation_explanation: item.formation,
      prefixes: "",
      suffixes: "",
      grammar_notes: "",
      example_sentences_json: "[]",
      related_word_ids_json: "[]",
      mnemonic: "",
      learning_status: "new",
      source: "generated",
      status: "draft",
      archived: 0,
      entry_version: 1,
      history_json: "[]",
      created_at: now,
      updated_at: now,
    });
    generatedDrafts += 1;
  }

  return { languageId, version, name, generatedDrafts };
}
