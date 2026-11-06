import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, CircleDashed, Loader2, RotateCcw } from "lucide-react";
import {
  api,
  downloadFile,
  ApiError,
  type GrammarData,
  type JobState,
  type LanguageSummary,
  type VersionCompare,
} from "../api.js";
import { describeApiError } from "../errors.js";
import { useSession } from "../state.js";
import { toast } from "sonner";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  Field,
  HonestNote,
  Input,
  LoadingScreen,
  Modal,
  PageHeader,
  Select,
} from "../ui.js";
import { formatWhen } from "./Dashboard.js";
import { GEN_STYLES } from "../api.js";

/* My Language: generation (with honest stage progress, resume across reloads,
 * cancel/retry), grammar review (sounds, affixes, example sentences),
 * version compare/restore, and rename. */

type Workspace = { id: string; name: string; role: "owner" | "admin" | "editor" | "viewer" };

const TERMINAL_STATUSES = ["completed", "failed", "cancelled", "timeout"];
/** A queued/running job silent this long is almost certainly orphaned: the
 * tab that ran it was closed. Said honestly, never silently retried. */
const STALE_AFTER_MS = 60_000;

function isStale(job: JobState): boolean {
  return (
    !TERMINAL_STATUSES.includes(job.status) &&
    job.updatedAt !== null &&
    Date.now() - Date.parse(job.updatedAt) > STALE_AFTER_MS
  );
}

export function MyLanguage({ workspace }: { workspace: Workspace }) {
  const [language, setLanguage] = useState<LanguageSummary | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [loading, setLoading] = useState(true);
  const [genOpen, setGenOpen] = useState(false);
  const [genPreset, setGenPreset] = useState<{ style: string; referenceLangs: string } | null>(null);
  const [regenConfirm, setRegenConfirm] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [grammar, setGrammar] = useState<GrammarData | null>(null);
  const [versions, setVersions] = useState<Array<{ version: number; change_summary: string; created_at: string }>>([]);
  const [dictionaryCount, setDictionaryCount] = useState<number | null>(null);
  const [starterBusy, setStarterBusy] = useState(false);
  const [compare, setCompare] = useState<{ a: number; b: number } | null>(null);
  const { workspaces } = useSession();
  const role = workspaces.find((w) => w.id === workspace.id)?.role ?? workspace.role;
  // TODO(iam-roles): local workspace ladder, not IAM roles (src/core/types.ts)
  const canEdit = role === "owner" || role === "admin" || role === "editor";

  const load = useCallback(async () => {
    const res = await api.get<{
      language: LanguageSummary | null;
      activeJob: { id: string } | null;
      dictionaryCount?: number;
    }>(`/api/ws/${workspace.id}/language`);
    setLanguage(res.language);
    setDictionaryCount(res.dictionaryCount ?? null);
    const activeId = res.activeJob?.id ?? null;
    if (!activeId) {
      setJob(null);
      return null;
    }
    // Reload mid-generation: rebuild the progress panel from the persisted
    // job instead of losing it (spec §17 -- keep the page usable).
    const state = await api
      .get<JobState>(`/api/ws/${workspace.id}/language/jobs/${activeId}`)
      .catch(() => null);
    setJob(state);
    return activeId;
  }, [workspace.id]);

  const refreshSideData = useCallback(() => {
    void api.get<GrammarData>(`/api/ws/${workspace.id}/language/grammar`).then(setGrammar).catch(() => setGrammar(null));
    void api
      .get<{ versions: Array<{ version: number; change_summary: string; created_at: string }> }>(`/api/ws/${workspace.id}/language/versions`)
      .then((r) => setVersions(r.versions))
      .catch(() => setVersions([]));
  }, [workspace.id]);

  useEffect(() => {
    document.title = "My Language · Lexora";
  }, []);

  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
    refreshSideData();
  }, [load, refreshSideData]);

  // Poll the active job until it reaches a terminal state.
  const pollRef = useRef<number | null>(null);
  useEffect(() => {
    if (!job || TERMINAL_STATUSES.includes(job.status)) return;
    pollRef.current = window.setInterval(() => {
      void (async () => {
        try {
          const next = await api.get<JobState>(`/api/ws/${workspace.id}/language/jobs/${job.id}`);
          setJob(next);
          if (TERMINAL_STATUSES.includes(next.status)) {
            window.clearInterval(pollRef.current ?? undefined);
            if (next.status === "completed" && next.result) {
              toast.success(`Language "${next.result.name}" is ready (version ${next.result.version}).`);
            } else if (next.status === "failed") {
              toast.error(next.error ?? "Generation failed. Nothing was saved.");
            } else if (next.status === "timeout") {
              toast.error("Generation took too long and was stopped. Nothing was saved; you can retry.");
            }
            await load();
            refreshSideData();
          }
        } catch {
          /* transient polling error — try again on the next tick */
        }
      })();
    }, 1200);
    return () => window.clearInterval(pollRef.current ?? undefined);
  }, [job, workspace.id, load, refreshSideData]);

  const addStarter = async () => {
    setStarterBusy(true);
    try {
      const res = await api.post<{ message: string }>(`/api/ws/${workspace.id}/dictionary/starter`, {});
      toast.success(res.message);
      await load();
    } catch (err) {
      toast.error(describeApiError(err, "Could not add the starter dictionary"));
    } finally {
      setStarterBusy(false);
    }
  };

  const cancelJob = async () => {
    if (!job) return;
    try {
      await api.post(`/api/ws/${workspace.id}/language/jobs/${job.id}/cancel`);
      toast.success("Generation cancelled. Nothing was saved.");
      await load();
    } catch (err) {
      toast.error(describeApiError(err, "Could not cancel the job"));
    }
  };

  const retryJob = () => {
    setGenPreset(
      job?.style && job?.referenceLangs
        ? { style: job.style, referenceLangs: job.referenceLangs }
        : null,
    );
    setGenOpen(true);
  };

  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadFile(`/api/ws/${workspace.id}/dictionary/export?format=csv`);
    } catch (err) {
      toast.error(describeApiError(err, "Export failed"));
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <LoadingScreen />;

  const considered = (language?.nameCandidates ?? []).filter((c) => c.name !== language?.name);

  return (
    <div>
      <PageHeader
        title="My Language"
        subtitle={language ? `Version ${language.version} · updated ${formatWhen(language.updatedAt)}` : "Generate your language from the dictionary."}
        actions={
          language && canEdit ? (
            <>
              <Button variant="outline" onClick={() => setRenameOpen(true)}>Rename</Button>
              <Button onClick={() => { setGenPreset(null); setRegenConfirm(true); }}>
                <RotateCcw size={15} /> Generate new version
              </Button>
            </>
          ) : null
        }
      />

      {!language && !job && (
        <EmptyState
          icon={<SparklesIcon />}
          title="Create your private language"
          body="Generate a language with its own name, vocabulary, pronunciation, and grammar, connected to your Bengali and English references."
          action={
            canEdit ? (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                <Button onClick={() => { setGenPreset(null); setGenOpen(true); }}>Generate My Language</Button>
                <Link to="/app/dictionary" className="btn btn-outline" style={{ textDecoration: "none" }}>Add Dictionary Words</Link>
                <Link to="/app/dictionary?import=1" className="btn btn-outline" style={{ textDecoration: "none" }}>Import Dictionary</Link>
                <Button variant="outline" onClick={addStarter} disabled={starterBusy}>
                  {starterBusy ? "Adding…" : "Start with the starter dictionary"}
                </Button>
              </div>
            ) : (
              <p className="bilingual">Ask an editor or admin to generate the language.</p>
            )
          }
        />
      )}

      {job && !language && <JobProgress job={job} onCancel={canEdit ? cancelJob : undefined} onRetry={canEdit ? retryJob : undefined} />}

      {language && (
        <>
          <div className="hero-language">
            <span className="badge">Private to your workspace · v{language.version}</span>
            <div className="native">
              {language.name} <span className="bn" lang="bn">{language.nativeName}</span>
            </div>
            <p className="desc">{language.description}</p>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 12, fontSize: 13, color: "#C9D5E2" }}>
              <span>Word order: <strong style={{ color: "#fff" }}>{language.wordOrder ?? ""}</strong></span>
              <span>Style: <strong style={{ color: "#fff" }}>{language.style ?? ""}</strong></span>
              <span>Words: <strong style={{ color: "#fff" }}>{language.vocabularyCount}</strong></span>
              <span>Rules: <strong style={{ color: "#fff" }}>{language.rulesCount}</strong></span>
              <span>Created: <strong style={{ color: "#fff" }}>{formatWhen(language.createdAt)}</strong></span>
            </div>
            {language.versionSummary && (
              <p className="bilingual" style={{ margin: "8px 0 0", fontSize: 13, color: "#C9D5E2" }}>{language.versionSummary}</p>
            )}
            {considered.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 13, color: "#C9D5E2" }}>
                Names considered:{" "}
                <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", verticalAlign: "middle" }}>
                  {considered.map((c) => (
                    <span key={c.name} className="chip" style={{ background: "rgba(255,255,255,0.12)", color: "#fff", borderColor: "transparent" }}>{c.name}</span>
                  ))}
                </span>
              </div>
            )}
            <div className="actions">
              <Link to="/app/dictionary" className="btn btn-outline" style={{ textDecoration: "none", background: "rgba(255,255,255,0.1)", color: "#fff", borderColor: "transparent" }}>
                Open Dictionary
              </Link>
              <Link to="/app/grammar" className="btn btn-outline" style={{ textDecoration: "none", background: "rgba(255,255,255,0.1)", color: "#fff", borderColor: "transparent" }}>
                Open Grammar Workspace
              </Link>
              <Link to="/app/practice" className="btn btn-outline" style={{ textDecoration: "none", background: "rgba(255,255,255,0.1)", color: "#fff", borderColor: "transparent" }}>
                Practice
              </Link>
              <button type="button" className="btn btn-outline" style={{ background: "rgba(255,255,255,0.1)", color: "#fff", borderColor: "transparent" }} onClick={exportCsv} disabled={exporting}>
                {exporting ? "Preparing…" : "Export"}
              </button>
            </div>
          </div>

          {job && (
            <JobProgress
              job={job}
              style={{ marginTop: 16 }}
              onCancel={canEdit ? cancelJob : undefined}
              onRetry={canEdit ? retryJob : undefined}
            />
          )}

          {language.warnings.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <h3>Consistency notes from the last generation</h3>
              <ul style={{ margin: 0, paddingLeft: 20, color: "var(--text-muted)", fontSize: 14 }}>
                {language.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {grammar && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-title">
                <h3>Grammar & sound rules</h3>
                <span className="bilingual">
                  {grammar.rules.length} rules · {grammar.exampleSentences.length} example sentences
                </span>
              </div>
              <p className="bilingual" style={{ marginBottom: 4 }}>
                Syllable rules: {grammar.phonology.syllableStructures.join(", ")}
              </p>
              {grammar.affixes && (
                <p className="bilingual" style={{ marginBottom: 4 }}>
                  Inflectional affixes: plural <code>-{grammar.affixes.plural}</code>, past <code>-{grammar.affixes.past}</code>, question <code>-{grammar.affixes.question}</code> … all seven live in the workspace.
                </p>
              )}
              <p className="bilingual" style={{ marginBottom: 10 }}>
                The full rulebook — sound inventory, word order, every rule with bilingual explanations, editable — has its own page now.
              </p>
              <Link to="/app/grammar" className="btn btn-primary" style={{ textDecoration: "none" }}>
                Open Grammar Workspace
              </Link>
            </div>
          )}
        </>
      )}

      {versions.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">
            <h3>Versions</h3>
            <span className="bilingual">Restoring creates a new version, nothing is overwritten.</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Summary</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.version}>
                    <td><strong>v{v.version}</strong>{v.version === language?.version && <span className="bilingual"> (current)</span>}</td>
                    <td>{v.change_summary}</td>
                    <td className="bilingual">{formatWhen(v.created_at)}</td>
                    <td>
                      <div style={{ display: "flex", gap: 8 }}>
                        {versions.length > 1 && (
                          <Button variant="outline" size="sm" onClick={() => openCompare(v.version)}>Compare</Button>
                        )}
                        {canEdit && v.version !== language?.version && (
                          <RestoreButton workspaceId={workspace.id} version={v.version} onDone={async () => {
                            await load();
                            refreshSideData();
                          }} />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {compare && (
        <CompareModal
          workspaceId={workspace.id}
          versions={versions}
          initialA={compare.a}
          initialB={compare.b}
          onClose={() => setCompare(null)}
        />
      )}

      {genOpen && (
        <GenerateDialog
          workspaceId={workspace.id}
          workspaceName={workspace.name}
          hasLanguage={Boolean(language)}
          dictionaryCount={dictionaryCount}
          preset={genPreset}
          onClose={() => setGenOpen(false)}
          onStarted={(j) => {
            setGenOpen(false);
            setJob(j);
            if (language) setRegenConfirm(false);
          }}
        />
      )}

      {regenConfirm && (
        <ConfirmDialog
          title="Generate a new version?"
          body={`A new version of "${language?.name}" will be created from your current dictionary. Vocabulary or grammar may change; your previous versions stay available for rollback.`}
          confirmLabel="Generate new version"
          onConfirm={() => {
            setRegenConfirm(false);
            setGenOpen(true);
          }}
          onCancel={() => setRegenConfirm(false)}
        />
      )}

      {renameOpen && language && (
        <RenameDialog
          workspaceId={workspace.id}
          current={language.name}
          onClose={() => setRenameOpen(false)}
          onRenamed={async (name) => {
            setRenameOpen(false);
            toast.success(`Renamed to "${name}".`);
            await load();
          }}
        />
      )}
    </div>
  );

  function openCompare(version: number) {
    const other =
      version !== language?.version
        ? language!.version
        : versions.find((v) => v.version !== version)?.version ?? version;
    setCompare({ a: Math.min(version, other), b: Math.max(version, other) });
  }
}

function SparklesIcon() {
  return <span aria-hidden="true" style={{ fontSize: 36 }}>✨</span>;
}

/* ------------------------------ generate dialog ------------------------------ */

function GenerateDialog({
  workspaceId,
  workspaceName,
  hasLanguage,
  dictionaryCount,
  preset,
  onClose,
  onStarted
}: {
  workspaceId: string;
  workspaceName: string;
  hasLanguage: boolean;
  dictionaryCount: number | null;
  preset: { style: string; referenceLangs: string } | null;
  onClose: () => void;
  onStarted: (job: JobState) => void;
}) {
  const [style, setStyle] = useState<string>(preset?.style ?? "naturalistic");
  const [referenceLangs, setReferenceLangs] = useState(preset?.referenceLangs ?? "both");
  const [preferredName, setPreferredName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [emptyDictionary, setEmptyDictionary] = useState(false);
  const [busy, setBusy] = useState(false);

  const addStarterInline = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ message: string }>(`/api/ws/${workspaceId}/dictionary/starter`, {});
      toast.success(res.message);
      setEmptyDictionary(false);
    } catch (err) {
      setError(describeApiError(err, "Could not add the starter dictionary"));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setEmptyDictionary(false);
    try {
      const res = await api.post<{ jobId: string }>(`/api/ws/${workspaceId}/language/generate`, {
        style,
        referenceLangs,
        ...(preferredName.trim() ? { preferredName: preferredName.trim() } : {})
      });
      onStarted({
        id: res.jobId,
        status: "queued",
        stages: [],
        result: null,
        error: null,
        style,
        referenceLangs,
        createdAt: null,
        updatedAt: null
      });
    } catch (err) {
      if (err instanceof ApiError && err.details === "dictionary_empty") {
        setEmptyDictionary(true);
        setError("Your dictionary is empty, so there is nothing to generate a language from yet.");
      } else {
        setError(describeApiError(err, "Generation could not start"));
      }
      setBusy(false);
    }
  };

  return (
    <Modal title={hasLanguage ? "Generate a new version" : "Generate your language"} onClose={onClose}>
      {hasLanguage && (
        <HonestNote>
          The new version is built from your current dictionary. Your previous version stays available under Versions.
        </HonestNote>
      )}
      {/* Setup summary (design.md §8): what the language will be built from. */}
      <div className="card" style={{ margin: "0 0 14px", padding: "12px 14px", background: "var(--surface-2, rgba(127,127,127,0.08))" }}>
        <p style={{ margin: "0 0 4px", fontSize: 14 }}><strong>{workspaceName}</strong></p>
        <p className="bilingual" style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
          {dictionaryCount === null
            ? "Dictionary entries: loading…"
            : `${dictionaryCount} dictionary ${dictionaryCount === 1 ? "entry" : "entries"} will be mapped into the language.`}
        </p>
      </div>
      <form onSubmit={submit} noValidate>
        <Field label="Preferred name (optional)" hint="Leave empty and Lexora will invent one. If it's already taken by another workspace, you'll get a unique alternative.">
          <Input value={preferredName} onChange={(e) => setPreferredName(e.target.value)} maxLength={40} placeholder="e.g. Nerava" />
        </Field>
        <Field label="Style">
          <Select value={style} onChange={(v) => setStyle(v)}>
            {GEN_STYLES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reference languages">
          <Select value={referenceLangs} onChange={(v) => setReferenceLangs(v)}>
            <option value="both">Bengali + English</option>
            <option value="bengali">Bengali</option>
            <option value="english">English</option>
          </Select>
        </Field>
        <ErrorNote message={error} />
        {emptyDictionary && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            <Button type="button" variant="outline" onClick={addStarterInline} disabled={busy}>
              Add starter words
            </Button>
            <Link to="/app/dictionary?import=1" className="btn btn-outline" style={{ textDecoration: "none" }}>Import words</Link>
          </div>
        )}
        <div className="modal-actions">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Starting…" : "Start generation"}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------- job progress -------------------------------- */

function JobProgress({
  job,
  style,
  onCancel,
  onRetry,
}: {
  job: JobState;
  style?: React.CSSProperties;
  onCancel?: () => void;
  onRetry?: () => void;
}) {
  const stale = isStale(job);
  const live = !TERMINAL_STATUSES.includes(job.status);
  const notes = (job.result?.warnings ?? []).filter((w) => w !== "No consistency problems found.");

  return (
    <div className="card" style={style} aria-live="polite">
      <div className="card-title">
        <h3>
          {job.status === "completed" ? "Generation complete" : job.status === "failed" ? "Generation failed" : job.status === "cancelled" ? "Generation cancelled" : job.status === "timeout" ? "Generation timed out" : "Generating your language…"}
        </h3>
        {job.status === "completed" && job.result && (
          <>
            {notes.length > 0 && <Badge tone="amber">Completed with {notes.length} consistency {notes.length === 1 ? "note" : "notes"}</Badge>}
            <Badge tone="green">v{job.result.version}</Badge>
          </>
        )}
      </div>
      {stale && (
        <HonestNote>
          This job has not updated in a while. If the tab that started it was closed, it stopped where it was and will not finish on its own — you can cancel it and start again.
        </HonestNote>
      )}
      {job.stages.length > 0 ? (
        <ul className="progress-list">
          {job.stages.map((s) => (
            <li key={s.id} className={s.status}>
              {s.status === "done" ? <CheckCircle2 size={16} /> : s.status === "running" ? <Loader2 size={16} className="spin" /> : <CircleDashed size={16} />}
              <span>{s.label}</span>
              <span className="bn bilingual" lang="bn" style={{ marginLeft: "auto" }}>{s.labelBn}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="bilingual">Starting the generation job…</p>
      )}
      {job.status === "completed" && job.result && (
        <p style={{ marginTop: 12 }}>
          <strong>{job.result.name}</strong> · {job.result.wordCount} words · {job.result.rulesCount} grammar rules ·{" "}
          {job.result.generatedDrafts} generated drafts are waiting in your dictionary for review.{" "}
          <Link to={`/app/dictionary?status=draft`}>Review {job.result.generatedDrafts} drafts</Link>
        </p>
      )}
      {job.error && <ErrorNote message={job.error} />}
      {(live || onRetry) && (
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          {live && onCancel && (
            <Button variant="outline" size="sm" onClick={onCancel}>Cancel generation</Button>
          )}
          {!live && onRetry && job.status !== "completed" && (
            <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------- version compare ----------------------------- */

function CompareModal({
  workspaceId,
  versions,
  initialA,
  initialB,
  onClose,
}: {
  workspaceId: string;
  versions: Array<{ version: number; change_summary: string; created_at: string }>;
  initialA: number;
  initialB: number;
  onClose: () => void;
}) {
  const [a, setA] = useState(initialA);
  const [b, setB] = useState(initialB);
  const [data, setData] = useState<VersionCompare | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sorted = [...versions].sort((x, y) => x.version - y.version);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    api
      .get<VersionCompare>(`/api/ws/${workspaceId}/language/versions/compare?a=${a}&b=${b}`)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((err) => {
        if (alive) setError(describeApiError(err, "Compare failed"));
      });
    return () => {
      alive = false;
    };
  }, [a, b, workspaceId]);

  const cap = (list: unknown[], slice: number): string =>
    list.length > slice ? ` (+${list.length - slice} more)` : "";

  return (
    <Modal title="Compare versions" onClose={onClose}>
      <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
        <Field label="From">
          <Select value={String(a)} onChange={(v) => setA(Number(v))} aria-label="From version">
            {sorted.map((v) => (
              <option key={v.version} value={v.version}>v{v.version}</option>
            ))}
          </Select>
        </Field>
        <Field label="To">
          <Select value={String(b)} onChange={(v) => setB(Number(v))} aria-label="To version">
            {sorted.map((v) => (
              <option key={v.version} value={v.version}>v{v.version}</option>
            ))}
          </Select>
        </Field>
      </div>
      <ErrorNote message={error} />
      {data && (
        <div>
          <p style={{ marginTop: 0 }}>
            <strong>v{data.from.version} → v{data.to.version}</strong> · <span className="bilingual">{data.diff.summary}</span>
          </p>
          {data.diff.nameChanged && (
            <p className="bilingual">Name: {data.diff.fromName} → <strong>{data.diff.toName}</strong></p>
          )}
          {data.diff.wordOrderChanged && (
            <p className="bilingual">Word order: {data.diff.fromWordOrder} → <strong>{data.diff.toWordOrder}</strong></p>
          )}
          {data.diff.rulesAdded.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <h4 style={{ margin: "10px 0 4px" }}>Rules added</h4>
              {data.diff.rulesAdded.slice(0, 20).map((r) => (
                <p key={r.id} style={{ margin: "2px 0", fontSize: 13 }}>+ {r.name} <span className="bilingual" style={{ color: "var(--text-muted)" }}>· {r.category}</span></p>
              ))}
              <span className="bilingual" style={{ fontSize: 12, color: "var(--text-muted)" }}>{cap(data.diff.rulesAdded, 20)}</span>
            </div>
          )}
          {data.diff.rulesRemoved.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <h4 style={{ margin: "10px 0 4px" }}>Rules removed</h4>
              {data.diff.rulesRemoved.slice(0, 20).map((r) => (
                <p key={r.id} style={{ margin: "2px 0", fontSize: 13 }}>− {r.name} <span className="bilingual" style={{ color: "var(--text-muted)" }}>· {r.category}</span></p>
              ))}
              <span className="bilingual" style={{ fontSize: 12, color: "var(--text-muted)" }}>{cap(data.diff.rulesRemoved, 20)}</span>
            </div>
          )}
          {data.diff.rulesChanged.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <h4 style={{ margin: "10px 0 4px" }}>Rules updated</h4>
              {data.diff.rulesChanged.slice(0, 20).map((r) => (
                <p key={r.after.id} style={{ margin: "2px 0", fontSize: 13 }}>~ {r.after.name}</p>
              ))}
              <span className="bilingual" style={{ fontSize: 12, color: "var(--text-muted)" }}>{cap(data.diff.rulesChanged, 20)}</span>
            </div>
          )}
          {(data.diff.vocabAdded.length > 0 || data.diff.vocabRemoved.length > 0) && (
            <div style={{ marginBottom: 8 }}>
              <h4 style={{ margin: "10px 0 4px" }}>Vocabulary</h4>
              {data.diff.vocabAdded.slice(0, 20).map((v) => (
                <span key={"add" + v.word} className="chip" style={{ marginRight: 6 }}>+ {v.word}</span>
              ))}
              {data.diff.vocabRemoved.slice(0, 20).map((v) => (
                <span key={"rem" + v.word} className="chip" style={{ marginRight: 6, textDecoration: "line-through" }}>− {v.word}</span>
              ))}
              <span className="bilingual" style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginTop: 4 }}>
                {cap(data.diff.vocabAdded, 20)}{cap(data.diff.vocabRemoved, 20)}
              </span>
            </div>
          )}
          {(data.diff.newWarnings.length > 0 || data.diff.resolvedWarnings.length > 0) && (
            <div>
              <h4 style={{ margin: "10px 0 4px" }}>Consistency notes</h4>
              {data.diff.newWarnings.slice(0, 10).map((w, i) => (
                <p key={"nw" + i} style={{ margin: "2px 0", fontSize: 13 }}>+ {w}</p>
              ))}
              {data.diff.resolvedWarnings.slice(0, 10).map((w, i) => (
                <p key={"rw" + i} style={{ margin: "2px 0", fontSize: 13, color: "var(--text-muted)" }}>− {w}</p>
              ))}
            </div>
          )}
        </div>
      )}
      {!data && !error && <p className="bilingual">Comparing…</p>}
    </Modal>
  );
}

/* --------------------------------- actions ----------------------------------- */

function RestoreButton({ workspaceId, version, onDone }: { workspaceId: string; version: number; onDone: () => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const doRestore = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ message: string; version: number }>(`/api/ws/${workspaceId}/language/versions/${version}/restore`);
      toast.success(res.message);
      setConfirm(false);
      await onDone();
    } catch (err) {
      toast.error(describeApiError(err, "Restore failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setConfirm(true)}>
        Restore
      </Button>
      {confirm && (
        <ConfirmDialog
          title={`Restore version ${version}?`}
          body={`Version ${version} will come back as a new version; the current one is kept in history.`}
          confirmLabel="Restore"
          onConfirm={doRestore}
          onCancel={() => setConfirm(false)}
          busy={busy}
        />
      )}
    </>
  );
}

function RenameDialog({ workspaceId, current, onClose, onRenamed }: { workspaceId: string; current: string; onClose: () => void; onRenamed: (name: string) => Promise<void> }) {
  const [name, setName] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/ws/${workspaceId}/language`, { name });
      await onRenamed(name);
    } catch (err) {
      setError(describeApiError(err, "Rename failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Rename language" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Field label="Language name" hint="Names are unique across all of Lexora.">
          <Input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={40} required autoFocus />
        </Field>
        <ErrorNote message={error} />
        <div className="modal-actions">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy || name.trim() === current}>{busy ? "Renaming…" : "Rename"}</Button>
        </div>
      </form>
    </Modal>
  );
}
