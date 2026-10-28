import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, CircleDashed, Loader2, RotateCcw } from "lucide-react";
import { api, type GrammarData, type JobState, type LanguageSummary } from "../api.js";
import { useSession } from "../state.js";
import { toast } from "sonner";
import { Badge, Button, ConfirmDialog, EmptyState, ErrorNote, Field, HonestNote, Input, LoadingScreen, Modal, PageHeader, Select, Stat } from "../ui.js";
import { formatWhen } from "./Dashboard.js";
import { GEN_STYLES } from "../api.js";

/* My Language: generation (with honest stage progress), grammar review,
 * versions with restore, and rename. */

type Workspace = { id: string; name: string; role: "owner" | "admin" | "editor" | "viewer" };

export function MyLanguage({ workspace }: { workspace: Workspace }) {
  const [language, setLanguage] = useState<LanguageSummary | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [loading, setLoading] = useState(true);
  const [genOpen, setGenOpen] = useState(false);
  const [regenConfirm, setRegenConfirm] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [grammar, setGrammar] = useState<GrammarData | null>(null);
  const [versions, setVersions] = useState<Array<{ version: number; change_summary: string; created_at: string }>>([]);
  const { workspaces } = useSession();
  const role = workspaces.find((w) => w.id === workspace.id)?.role ?? workspace.role;
  const canEdit = role === "owner" || role === "admin" || role === "editor";

  const load = useCallback(async () => {
    const res = await api.get<{ language: LanguageSummary | null; activeJob: { id: string; status: string } | null }>(
      `/api/ws/${workspace.id}/language`
    );
    setLanguage(res.language);
    setJob(null);
    return res.activeJob?.id ?? null;
  }, [workspace.id]);

  useEffect(() => {
    document.title = "My Language · Lexora";
  }, []);

  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
    void api.get<GrammarData>(`/api/ws/${workspace.id}/language/grammar`).then(setGrammar).catch(() => setGrammar(null));
    void api.get<{ versions: Array<{ version: number; change_summary: string; created_at: string }> }>(`/api/ws/${workspace.id}/language/versions`)
      .then((r) => setVersions(r.versions))
      .catch(() => setVersions([]));
  }, [load, workspace.id]);

  // Poll the active job until it reaches a terminal state.
  const pollRef = useRef<number | null>(null);
  useEffect(() => {
    if (!job || ["completed", "failed", "cancelled", "timeout"].includes(job.status)) return;
    pollRef.current = window.setInterval(() => {
      void (async () => {
        try {
          const next = await api.get<JobState>(`/api/ws/${workspace.id}/language/jobs/${job.id}`);
          setJob(next);
          if (["completed", "failed", "cancelled", "timeout"].includes(next.status)) {
            window.clearInterval(pollRef.current ?? undefined);
            if (next.status === "completed" && next.result) {
              toast.success(`Language "${next.result.name}" is ready (version ${next.result.version}).`);
            } else if (next.status === "failed") {
              toast.error(next.error ?? "Generation failed. Nothing was saved.");
            } else if (next.status === "timeout") {
              toast.error("Generation took too long and was stopped. Nothing was saved; you can retry.");
            }
            await load();
            void api.get<GrammarData>(`/api/ws/${workspace.id}/language/grammar`).then(setGrammar).catch(() => setGrammar(null));
            void api
              .get<{ versions: Array<{ version: number; change_summary: string; created_at: string }> }>(`/api/ws/${workspace.id}/language/versions`)
              .then((r) => setVersions(r.versions))
              .catch(() => setVersions([]));
          }
        } catch {
          /* transient polling error — try again on the next tick */
        }
      })();
    }, 1200);
    return () => window.clearInterval(pollRef.current ?? undefined);
  }, [job, workspace.id, load, toast]);

  if (loading) return <LoadingScreen />;

  return (
    <div>
      <PageHeader
        title="My Language"
        subtitle={language ? `Version ${language.version} · updated ${formatWhen(language.updatedAt)}` : "Generate your language from the dictionary."}
        actions={
          language && canEdit ? (
            <>
              <Button variant="outline" onClick={() => setRenameOpen(true)}>Rename</Button>
              <Button onClick={() => setRegenConfirm(true)}>
                <RotateCcw size={15} /> Generate new version
              </Button>
            </>
          ) : null
        }
      />

      {!language && !job && (
        <EmptyState
          icon={<SparklesIcon />}
          title="No language yet"
          body="Your dictionary is the raw material. Generate a language from it: sound rules, words, grammar and example sentences, all reviewable."
          action={
            canEdit ? (
              <Button onClick={() => setGenOpen(true)}>Generate my language</Button>
            ) : (
              <p className="bilingual">Ask an editor or admin to generate the language.</p>
            )
          }
        />
      )}

      {job && !language && <JobProgress job={job} />}

      {language && (
        <>
          <div className="hero-language">
            <span className="badge">Private to your workspace · v{language.version}</span>
            <div className="native">
              {language.name} <span className="bn">{language.nativeName}</span>
            </div>
            <p className="desc">{language.description}</p>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 12, fontSize: 13, color: "#C9D5E2" }}>
              <span>Word order: <strong style={{ color: "#fff" }}>{language.wordOrder ?? ""}</strong></span>
              <span>Style: <strong style={{ color: "#fff" }}>{language.style ?? ""}</strong></span>
              <span>Words: <strong style={{ color: "#fff" }}>{language.vocabularyCount}</strong></span>
              <span>Rules: <strong style={{ color: "#fff" }}>{language.rulesCount}</strong></span>
            </div>
            <div className="actions">
              <Link to="/app/dictionary" className="btn btn-outline" style={{ textDecoration: "none", background: "rgba(255,255,255,0.1)", color: "#fff", borderColor: "transparent" }}>
                Explore Dictionary
              </Link>
              <Link to="/app/translate" className="btn btn-outline" style={{ textDecoration: "none", background: "rgba(255,255,255,0.1)", color: "#fff", borderColor: "transparent" }}>
                Translation Lab
              </Link>
            </div>
          </div>

          {job && <JobProgress job={job} style={{ marginTop: 16 }} />}

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

          {grammar && <GrammarReview grammar={grammar} />}
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
                      {canEdit && v.version !== language?.version && (
                        <RestoreButton workspaceId={workspace.id} version={v.version} onDone={async () => {
                          await load();
                          void api.get<GrammarData>(`/api/ws/${workspace.id}/language/grammar`).then(setGrammar).catch(() => setGrammar(null));
                          void api
                            .get<{ versions: Array<{ version: number; change_summary: string; created_at: string }> }>(`/api/ws/${workspace.id}/language/versions`)
                            .then((r) => setVersions(r.versions))
                            .catch(() => setVersions([]));
                        }} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {genOpen && (
        <GenerateDialog
          workspaceId={workspace.id}
          hasLanguage={Boolean(language)}
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
}

function SparklesIcon() {
  return <span aria-hidden="true" style={{ fontSize: 36 }}>✨</span>;
}

/* ------------------------------ generate dialog ------------------------------ */

function GenerateDialog({
  workspaceId,
  hasLanguage,
  onClose,
  onStarted
}: {
  workspaceId: string;
  hasLanguage: boolean;
  onClose: () => void;
  onStarted: (job: JobState) => void;
}) {
  const [style, setStyle] = useState<string>("naturalistic");
  const [referenceLangs, setReferenceLangs] = useState("both");
  const [preferredName, setPreferredName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
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
        error: null
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation could not start");
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
        <div className="modal-actions">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Starting…" : "Start generation"}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------- job progress -------------------------------- */

function JobProgress({ job, style }: { job: JobState; style?: React.CSSProperties }) {
  return (
    <div className="card" style={style} aria-live="polite">
      <div className="card-title">
        <h3>
          {job.status === "completed" ? "Generation complete" : job.status === "failed" ? "Generation failed" : job.status === "cancelled" ? "Generation cancelled" : job.status === "timeout" ? "Generation timed out" : "Generating your language…"}
        </h3>
        {job.status === "completed" && job.result && <Badge tone="green">v{job.result.version}</Badge>}
      </div>
      {job.stages.length > 0 ? (
        <ul className="progress-list">
          {job.stages.map((s) => (
            <li key={s.id} className={s.status}>
              {s.status === "done" ? <CheckCircle2 size={16} /> : s.status === "running" ? <Loader2 size={16} className="spin" /> : <CircleDashed size={16} />}
              <span>{s.label}</span>
              <span className="bn bilingual" style={{ marginLeft: "auto" }}>{s.labelBn}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="bilingual">Starting the generation job…</p>
      )}
      {job.status === "completed" && job.result && (
        <p style={{ marginTop: 12 }}>
          <strong>{job.result.name}</strong> · {job.result.wordCount} words · {job.result.rulesCount} grammar rules ·{" "}
          {job.result.generatedDrafts} generated drafts are waiting in your dictionary for review.
        </p>
      )}
      {job.error && <ErrorNote message={job.error} />}
    </div>
  );
}

/* -------------------------------- grammar review ------------------------------ */

function GrammarReview({ grammar }: { grammar: GrammarData }) {
  const [openId, setOpenId] = useState<string | null>(grammar.rules[0]?.id ?? null);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-title">
        <h3>Grammar & sound rules</h3>
        <span className="bilingual">Review everything, you can regenerate any time.</span>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div>
          <h4>Writing system</h4>
          <p className="bilingual" style={{ marginBottom: 6 }}>{grammar.writingSystem.type}</p>
          <div className="chips" style={{ marginBottom: 8 }}>
            {grammar.writingSystem.alphabet.map((a) => (
              <span key={a} className="chip mono">{a}</span>
            ))}
          </div>
          <p className="bilingual">{grammar.writingSystem.capitalization}</p>
        </div>
        <div>
          <h4>Phonology</h4>
          <p className="bilingual" style={{ marginBottom: 4 }}>
            Consonants: {grammar.phonology.consonants.join(", ")}
          </p>
          <p className="bilingual" style={{ marginBottom: 4 }}>
            Vowels: {grammar.phonology.vowels.join(", ")}
          </p>
          <p className="bilingual" style={{ marginBottom: 4 }}>
            Syllables: {grammar.phonology.syllableStructures.join(", ")}
          </p>
          <p className="bilingual">{grammar.phonology.stressRule}</p>
        </div>
      </div>

      {(grammar.wordFormation.prefixes.length > 0 || grammar.wordFormation.suffixes.length > 0) && (
        <div style={{ marginBottom: 16 }}>
          <h4>Word formation</h4>
          <div className="chips">
            {grammar.wordFormation.prefixes.map((p) => (
              <span key={"p" + p.affix} className="chip">{p.affix}- = {p.meaning}</span>
            ))}
            {grammar.wordFormation.suffixes.map((s) => (
              <span key={"s" + s.affix} className="chip">-{s.affix} = {s.meaning}</span>
            ))}
          </div>
        </div>
      )}

      <h4>Rules ({grammar.rules.length})</h4>
      {grammar.rules.map((rule) => (
        <div className="accordion" key={rule.id}>
          <button className="accordion-head" onClick={() => setOpenId(openId === rule.id ? null : rule.id)} aria-expanded={openId === rule.id}>
            <span>
              {rule.name} <span className="bilingual">· {rule.category}</span>
            </span>
            <span className="bilingual">{openId === rule.id ? "−" : "+"}</span>
          </button>
          {openId === rule.id && (
            <div className="accordion-body">
              <p style={{ marginTop: 10 }}>{rule.explanationEnglish}</p>
              <p className="bn bilingual">{rule.explanationBengali}</p>
              {rule.pattern && (
                <p>
                  Pattern: <code>{rule.pattern}</code>
                </p>
              )}
              {rule.validExamples.length > 0 && (
                <p>
                  {rule.validExamples.map((v) => (
                    <span key={v} style={{ display: "inline-block", marginRight: 10 }}>
                      <code>{v}</code>
                    </span>
                  ))}
                </p>
              )}
              {rule.invalidExamples.map((iv) => (
                <p key={iv.example} style={{ color: "var(--danger)", fontSize: 13 }}>
                  ✗ {iv.example}: {iv.why}
                </p>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
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
      toast.error(err instanceof Error ? err.message : "Restore failed");
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
      setError(err instanceof Error ? err.message : "Rename failed");
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
