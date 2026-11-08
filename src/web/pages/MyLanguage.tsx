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
import { t } from "../i18n/index.js";

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
              toast.success(t("generation.toast.ready", { name: next.result.name, version: next.result.version }));
            } else if (next.status === "failed") {
              toast.error(next.error ?? t("generation.toast.failed_default"));
            } else if (next.status === "timeout") {
              toast.error(t("generation.toast.timeout"));
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
      toast.error(describeApiError(err, t("generation.starter.error")));
    } finally {
      setStarterBusy(false);
    }
  };

  const cancelJob = async () => {
    if (!job) return;
    try {
      await api.post(`/api/ws/${workspace.id}/language/jobs/${job.id}/cancel`);
      toast.success(t("generation.cancel.toast"));
      await load();
    } catch (err) {
      toast.error(describeApiError(err, t("generation.cancel.error")));
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
      toast.error(describeApiError(err, t("generation.export.failed")));
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <LoadingScreen />;

  const considered = (language?.nameCandidates ?? []).filter((c) => c.name !== language?.name);

  return (
    <div>
      <PageHeader
        title={t("generation.title")}
        subtitle={language ? t("generation.subtitle_version", { version: language.version, when: formatWhen(language.updatedAt) }) : t("generation.subtitle_empty")}
        actions={
          language && canEdit ? (
            <>
              <Button variant="outline" onClick={() => setRenameOpen(true)}>{t("generation.action.rename")}</Button>
              <Button onClick={() => { setGenPreset(null); setRegenConfirm(true); }}>
                <RotateCcw size={15} /> {t("generation.action.generate_new")}
              </Button>
            </>
          ) : null
        }
      />

      {!language && !job && (
        <EmptyState
          icon={<SparklesIcon />}
          title={t("generation.empty.title")}
          body={t("generation.empty.body")}
          action={
            canEdit ? (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                <Button onClick={() => { setGenPreset(null); setGenOpen(true); }}>{t("generation.empty.generate")}</Button>
                <Link to="/app/dictionary" className="btn btn-outline" style={{ textDecoration: "none" }}>{t("generation.empty.add_words")}</Link>
                <Link to="/app/dictionary?import=1" className="btn btn-outline" style={{ textDecoration: "none" }}>{t("generation.empty.import")}</Link>
                <Button variant="outline" onClick={addStarter} disabled={starterBusy}>
                  {starterBusy ? t("generation.empty.starter_busy") : t("generation.empty.starter")}
                </Button>
              </div>
            ) : (
              <p className="bilingual">{t("generation.empty.viewer_note")}</p>
            )
          }
        />
      )}

      {job && !language && <JobProgress job={job} onCancel={canEdit ? cancelJob : undefined} onRetry={canEdit ? retryJob : undefined} />}

      {language && (
        <>
          <div className="hero-language">
            <span className="badge">{t("generation.hero.private_badge", { version: language.version })}</span>
            <div className="native">
              {language.name} <span className="bn" lang="bn">{language.nativeName}</span>
            </div>
            <p className="desc">{language.description}</p>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 12, fontSize: 13, color: "#C9D5E2" }}>
              <span>{t("generation.hero.word_order")} <strong style={{ color: "#fff" }}>{language.wordOrder ?? ""}</strong></span>
              <span>{t("generation.hero.style")} <strong style={{ color: "#fff" }}>{language.style ?? ""}</strong></span>
              <span>{t("generation.hero.words")} <strong style={{ color: "#fff" }}>{language.vocabularyCount}</strong></span>
              <span>{t("generation.hero.rules")} <strong style={{ color: "#fff" }}>{language.rulesCount}</strong></span>
              <span>{t("generation.hero.created")} <strong style={{ color: "#fff" }}>{formatWhen(language.createdAt)}</strong></span>
            </div>
            {language.versionSummary && (
              <p className="bilingual" style={{ margin: "8px 0 0", fontSize: 13, color: "#C9D5E2" }}>{language.versionSummary}</p>
            )}
            {considered.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 13, color: "#C9D5E2" }}>
                {t("generation.hero.names_considered")}{" "}
                <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", verticalAlign: "middle" }}>
                  {considered.map((c) => (
                    <span key={c.name} className="chip" style={{ background: "rgba(255,255,255,0.12)", color: "#fff", borderColor: "transparent" }}>{c.name}</span>
                  ))}
                </span>
              </div>
            )}
            <div className="actions">
              <Link to="/app/dictionary" className="btn btn-outline" style={{ textDecoration: "none", background: "rgba(255,255,255,0.1)", color: "#fff", borderColor: "transparent" }}>
                {t("generation.hero.open_dictionary")}
              </Link>
              <Link to="/app/grammar" className="btn btn-outline" style={{ textDecoration: "none", background: "rgba(255,255,255,0.1)", color: "#fff", borderColor: "transparent" }}>
                {t("generation.hero.open_grammar")}
              </Link>
              <Link to="/app/practice" className="btn btn-outline" style={{ textDecoration: "none", background: "rgba(255,255,255,0.1)", color: "#fff", borderColor: "transparent" }}>
                {t("generation.hero.practice")}
              </Link>
              <button type="button" className="btn btn-outline" style={{ background: "rgba(255,255,255,0.1)", color: "#fff", borderColor: "transparent" }} onClick={exportCsv} disabled={exporting}>
                {exporting ? t("generation.export.preparing") : t("common.export")}
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
              <h3>{t("generation.warnings.title")}</h3>
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
                <h3>{t("generation.grammar.title")}</h3>
                <span className="bilingual">
                  {t("generation.grammar.counts", { rules: grammar.rules.length, sentences: grammar.exampleSentences.length })}
                </span>
              </div>
              <p className="bilingual" style={{ marginBottom: 4 }}>
                {t("generation.grammar.syllable")} {grammar.phonology.syllableStructures.join(", ")}
              </p>
              {grammar.affixes && (
                <p className="bilingual" style={{ marginBottom: 4 }}>
                  {t("generation.grammar.affixes_line", { plural: grammar.affixes.plural, past: grammar.affixes.past, question: grammar.affixes.question })}
                </p>
              )}
              <p className="bilingual" style={{ marginBottom: 10 }}>
                {t("generation.grammar.full_rulebook")}
              </p>
              <Link to="/app/grammar" className="btn btn-primary" style={{ textDecoration: "none" }}>
                {t("generation.hero.open_grammar")}
              </Link>
            </div>
          )}
        </>
      )}

      {versions.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">
            <h3>{t("generation.versions.title")}</h3>
            <span className="bilingual">{t("generation.versions.note")}</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("generation.versions.column_version")}</th>
                  <th>{t("generation.versions.column_summary")}</th>
                  <th>{t("generation.versions.column_created")}</th>
                  <th>{t("generation.versions.column_actions")}</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.version}>
                    <td><strong>v{v.version}</strong>{v.version === language?.version && <span className="bilingual"> {t("generation.versions.current")}</span>}</td>
                    <td>{v.change_summary}</td>
                    <td className="bilingual">{formatWhen(v.created_at)}</td>
                    <td>
                      <div style={{ display: "flex", gap: 8 }}>
                        {versions.length > 1 && (
                          <Button variant="outline" size="sm" onClick={() => openCompare(v.version)}>{t("generation.versions.compare")}</Button>
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
          title={t("generation.regen.title")}
          body={t("generation.regen.body", { name: language?.name ?? "" })}
          confirmLabel={t("generation.regen.confirm")}
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
            toast.success(t("generation.rename.toast", { name }));
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
      setError(describeApiError(err, t("generation.starter.error")));
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
        setError(t("generation.dialog.empty_dictionary"));
      } else {
        setError(describeApiError(err, t("generation.dialog.start_error")));
      }
      setBusy(false);
    }
  };

  return (
    <Modal title={hasLanguage ? t("generation.dialog.title_regen") : t("generation.dialog.title_new")} onClose={onClose}>
      {hasLanguage && (
        <HonestNote>
          {t("generation.dialog.honest_note")}
        </HonestNote>
      )}
      {/* Setup summary (design.md §8): what the language will be built from. */}
      <div className="card" style={{ margin: "0 0 14px", padding: "12px 14px", background: "var(--surface-2, rgba(127,127,127,0.08))" }}>
        <p style={{ margin: "0 0 4px", fontSize: 14 }}><strong>{workspaceName}</strong></p>
        <p className="bilingual" style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
          {dictionaryCount === null
            ? t("generation.dialog.entries_loading")
            : dictionaryCount === 1
              ? t("generation.dialog.entries_one")
              : t("generation.dialog.entries_many", { count: dictionaryCount })}
        </p>
      </div>
      <form onSubmit={submit} noValidate>
        <Field label={t("generation.dialog.name_label")} hint={t("generation.dialog.name_hint")}>
          <Input value={preferredName} onChange={(e) => setPreferredName(e.target.value)} maxLength={40} placeholder={t("generation.dialog.name_placeholder")} />
        </Field>
        <Field label={t("generation.dialog.style_label")}>
          <Select value={style} onChange={(v) => setStyle(v)}>
            {GEN_STYLES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("generation.dialog.refs_label")}>
          <Select value={referenceLangs} onChange={(v) => setReferenceLangs(v)}>
            <option value="both">{t("generation.dialog.refs_both")}</option>
            <option value="bengali">{t("generation.dialog.refs_bengali")}</option>
            <option value="english">{t("generation.dialog.refs_english")}</option>
          </Select>
        </Field>
        <ErrorNote message={error} />
        {emptyDictionary && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            <Button type="button" variant="outline" onClick={addStarterInline} disabled={busy}>
              {t("generation.dialog.add_starter")}
            </Button>
            <Link to="/app/dictionary?import=1" className="btn btn-outline" style={{ textDecoration: "none" }}>{t("generation.dialog.import_words")}</Link>
          </div>
        )}
        <div className="modal-actions">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={busy}>{busy ? t("generation.dialog.starting") : t("generation.dialog.start")}</Button>
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
          {job.status === "completed"
            ? t("generation.job.title_done")
            : job.status === "failed"
              ? t("generation.job.title_failed")
              : job.status === "cancelled"
                ? t("generation.job.title_cancelled")
                : job.status === "timeout"
                  ? t("generation.job.title_timeout")
                  : t("generation.job.title_running")}
        </h3>
        {job.status === "completed" && job.result && (
          <>
            {notes.length > 0 && (
              <Badge tone="amber">
                {notes.length === 1
                  ? t("generation.job.completed_notes_one", { count: notes.length })
                  : t("generation.job.completed_notes_many", { count: notes.length })}
              </Badge>
            )}
            <Badge tone="green">v{job.result.version}</Badge>
          </>
        )}
      </div>
      {stale && (
        <HonestNote>
          {t("generation.job.stale_note")}
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
        <p className="bilingual">{t("generation.job.starting_line")}</p>
      )}
      {job.status === "completed" && job.result && (
        <p style={{ marginTop: 12 }}>
          <strong>{job.result.name}</strong> ·{" "}
          {t("generation.job.result_line", { words: job.result.wordCount, rules: job.result.rulesCount, drafts: job.result.generatedDrafts })}{" "}
          <Link to={`/app/dictionary?status=draft`}>{t("generation.job.review_link", { count: job.result.generatedDrafts })}</Link>
        </p>
      )}
      {job.error && <ErrorNote message={job.error} />}
      {(live || onRetry) && (
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          {live && onCancel && (
            <Button variant="outline" size="sm" onClick={onCancel}>{t("generation.job.cancel")}</Button>
          )}
          {!live && onRetry && job.status !== "completed" && (
            <Button variant="outline" size="sm" onClick={onRetry}>{t("generation.job.try_again")}</Button>
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
        if (alive) setError(describeApiError(err, t("generation.compare.failed")));
      });
    return () => {
      alive = false;
    };
  }, [a, b, workspaceId]);

  const cap = (list: unknown[], slice: number): string =>
    list.length > slice ? t("generation.compare.more", { count: list.length - slice }) : "";

  return (
    <Modal title={t("generation.compare.title")} onClose={onClose}>
      <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
        <Field label={t("common.from")}>
          <Select value={String(a)} onChange={(v) => setA(Number(v))} aria-label={t("generation.compare.from_aria")}>
            {sorted.map((v) => (
              <option key={v.version} value={v.version}>v{v.version}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("common.to")}>
          <Select value={String(b)} onChange={(v) => setB(Number(v))} aria-label={t("generation.compare.to_aria")}>
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
            <strong>{t("generation.compare.versions_line", { from: data.from.version, to: data.to.version })}</strong> · <span className="bilingual">{data.diff.summary}</span>
          </p>
          {data.diff.nameChanged && (
            <p className="bilingual">{t("generation.compare.name", { from: data.diff.fromName })} <strong>{data.diff.toName}</strong></p>
          )}
          {data.diff.wordOrderChanged && (
            <p className="bilingual">{t("generation.compare.word_order", { from: data.diff.fromWordOrder })} <strong>{data.diff.toWordOrder}</strong></p>
          )}
          {data.diff.rulesAdded.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <h4 style={{ margin: "10px 0 4px" }}>{t("generation.compare.rules_added")}</h4>
              {data.diff.rulesAdded.slice(0, 20).map((r) => (
                <p key={r.id} style={{ margin: "2px 0", fontSize: 13 }}>+ {r.name} <span className="bilingual" style={{ color: "var(--text-muted)" }}>· {r.category}</span></p>
              ))}
              <span className="bilingual" style={{ fontSize: 12, color: "var(--text-muted)" }}>{cap(data.diff.rulesAdded, 20)}</span>
            </div>
          )}
          {data.diff.rulesRemoved.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <h4 style={{ margin: "10px 0 4px" }}>{t("generation.compare.rules_removed")}</h4>
              {data.diff.rulesRemoved.slice(0, 20).map((r) => (
                <p key={r.id} style={{ margin: "2px 0", fontSize: 13 }}>− {r.name} <span className="bilingual" style={{ color: "var(--text-muted)" }}>· {r.category}</span></p>
              ))}
              <span className="bilingual" style={{ fontSize: 12, color: "var(--text-muted)" }}>{cap(data.diff.rulesRemoved, 20)}</span>
            </div>
          )}
          {data.diff.rulesChanged.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <h4 style={{ margin: "10px 0 4px" }}>{t("generation.compare.rules_updated")}</h4>
              {data.diff.rulesChanged.slice(0, 20).map((r) => (
                <p key={r.after.id} style={{ margin: "2px 0", fontSize: 13 }}>~ {r.after.name}</p>
              ))}
              <span className="bilingual" style={{ fontSize: 12, color: "var(--text-muted)" }}>{cap(data.diff.rulesChanged, 20)}</span>
            </div>
          )}
          {(data.diff.vocabAdded.length > 0 || data.diff.vocabRemoved.length > 0) && (
            <div style={{ marginBottom: 8 }}>
              <h4 style={{ margin: "10px 0 4px" }}>{t("generation.compare.vocabulary")}</h4>
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
              <h4 style={{ margin: "10px 0 4px" }}>{t("generation.compare.notes")}</h4>
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
      {!data && !error && <p className="bilingual">{t("common.comparing")}</p>}
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
      toast.error(describeApiError(err, t("generation.restore.failed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setConfirm(true)}>
        {t("generation.versions.restore")}
      </Button>
      {confirm && (
        <ConfirmDialog
          title={t("generation.restore.confirm_title", { version })}
          body={t("generation.restore.confirm_body", { version })}
          confirmLabel={t("generation.restore.confirm_label")}
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
      setError(describeApiError(err, t("generation.rename.failed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t("generation.rename.title")} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Field label={t("generation.rename.label")} hint={t("generation.rename.hint")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={40} required autoFocus />
        </Field>
        <ErrorNote message={error} />
        <div className="modal-actions">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={busy || name.trim() === current}>{busy ? t("generation.rename.busy") : t("generation.action.rename")}</Button>
        </div>
      </form>
    </Modal>
  );
}
