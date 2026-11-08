import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  Braces,
  Download,
  FileSpreadsheet,
  FileUp,
  Pencil,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import {
  api,
  downloadFile,
  PARTS_OF_SPEECH,
  type EntryDTO,
  type ImportReport,
} from "../api.js";
import { describeApiError } from "../errors.js";
import { useSession } from "../state.js";
import { toast } from "sonner";
import { t } from "../i18n/index.js";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  LoadingScreen,
  Modal,
  PageHeader,
  Select,
  SourceBadge,
  Spinner,
  StatusBadge,
  Textarea,
} from "../ui.js";

type Workspace = {
  id: string;
  name: string;
  role: "owner" | "admin" | "editor" | "viewer";
};

interface ListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: EntryDTO[];
}

const EMPTY_FORM = {
  word: "",
  bengaliMeaning: "",
  englishMeaning: "",
  pronunciationGuide: "",
  ipa: "",
  partOfSpeech: "noun",
  root: "",
  wordFormationExplanation: "",
  grammarNotes: "",
  mnemonic: "",
  examplesText: "",
};

type FormState = typeof EMPTY_FORM;

function formFromEntry(e: EntryDTO): FormState {
  return {
    word: e.word,
    bengaliMeaning: e.bengaliMeaning,
    englishMeaning: e.englishMeaning,
    pronunciationGuide: e.pronunciationGuide,
    ipa: e.ipa,
    partOfSpeech: e.partOfSpeech,
    root: e.root,
    wordFormationExplanation: e.wordFormationExplanation,
    grammarNotes: e.grammarNotes,
    mnemonic: e.mnemonic,
    examplesText: e.exampleSentences
      .map((s) => [s.constructed, s.english, s.bengali].join(" | "))
      .join("\n"),
  };
}

function payloadFromForm(f: FormState) {
  return {
    word: f.word,
    bengaliMeaning: f.bengaliMeaning,
    englishMeaning: f.englishMeaning,
    pronunciationGuide: f.pronunciationGuide,
    ipa: f.ipa,
    partOfSpeech: f.partOfSpeech,
    root: f.root,
    wordFormationExplanation: f.wordFormationExplanation,
    grammarNotes: f.grammarNotes,
    mnemonic: f.mnemonic,
    exampleSentences: f.examplesText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, i) => {
        const [constructed = "", english = "", bengali = ""] = line
          .split("|")
          .map((p) => p.trim());
        return {
          id: `ex-${i + 1}`,
          constructed,
          english,
          bengali,
          gloss: [],
          grammarNotes: "",
          reviewStatus: "approved" as const,
        };
      }),
  };
}

export function DictionaryPage({ workspace }: { workspace: Workspace }) {
  const [data, setData] = useState<ListResponse | null>(null);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("alpha");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EntryDTO | "new" | null>(null);
  const [ioOpen, setIoOpen] = useState<"import" | "export" | null>(null);
  const { workspaces } = useSession();
  const role =
    workspaces.find((w) => w.id === workspace.id)?.role ?? workspace.role;
  // TODO(iam-roles): local workspace ladder, not IAM roles (src/core/types.ts)
  const canWrite = role === "owner" || role === "admin" || role === "editor";

  // Deep links from the generation flow: /app/dictionary?status=draft lands on
  // the "Review drafts" queue, ?import=1 opens the import dialog directly.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const statusParam = searchParams.get("status");
    if (statusParam === "draft" || statusParam === "approved") {
      setStatus(statusParam);
      setSource("");
      setPage(1);
    }
    if (searchParams.get("import") === "1" && canWrite) {
      setIoOpen("import");
    }
    if (statusParam || searchParams.get("import")) {
      setSearchParams({}, { replace: true });
    }
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.title = "Dictionary · Lexora";
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "20",
        sort,
      });
      if (q.trim()) params.set("q", q.trim());
      if (pos) params.set("pos", pos);
      if (source) params.set("source", source);
      if (status) params.set("status", status);
      const res = await api.get<ListResponse>(
        `/api/ws/${workspace.id}/dictionary?${params.toString()}`,
      );
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [workspace.id, page, q, pos, source, status, sort]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), q ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [load, q]);

  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / data.pageSize))
    : 1;

  // First load: a bare centered spinner filling the viewport, so the page
  // never overflows (header and toolbar appear once data is in).
  if (!data && loading) return <LoadingScreen />;

  return (
    <div>
      <PageHeader
        title={t("dictionary.title")}
        subtitle={t("dictionary.subtitle", { count: data?.total ?? "…" })}
        actions={
          <>
            {canWrite && (
              <Button variant="outline" onClick={() => setIoOpen("import")}>
                <FileUp size={15} /> {t("common.import")}
              </Button>
            )}
            <Button variant="outline" onClick={() => setIoOpen("export")}>
              <Download size={15} /> {t("common.export")}
            </Button>
            {canWrite && (
              <Button onClick={() => setEditing("new")}>
                <Plus size={15} /> {t("dictionary.add_word")}
              </Button>
            )}
          </>
        }
      />

      <div className="toolbar">
        <div className="grow" style={{ position: "relative" }}>
          <Search
            size={15}
            style={{
              position: "absolute",
              left: 10,
              top: 11,
              color: "var(--text-muted)",
            }}
          />
          <Input
            placeholder={t("dictionary.search_placeholder")}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            style={{ paddingLeft: 32 }}
            aria-label={t("dictionary.search_aria")}
          />
        </div>
        <Select
          value={pos}
          onChange={(v) => {
            setPos(v);
            setPage(1);
          }}
          aria-label={t("dictionary.filter.pos_aria")}
        >
          <option value="">{t("dictionary.filter.pos_all")}</option>
          {PARTS_OF_SPEECH.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <Select
          value={source}
          onChange={(v) => {
            setSource(v);
            setPage(1);
          }}
          aria-label={t("dictionary.filter.source_aria")}
        >
          <option value="">{t("dictionary.filter.source_all")}</option>
          <option value="user">{t("dictionary.filter.source_user")}</option>
          <option value="generated">{t("dictionary.filter.source_generated")}</option>
          <option value="imported">{t("dictionary.filter.source_imported")}</option>
        </Select>
        <Select
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          aria-label={t("dictionary.filter.status_aria")}
        >
          <option value="">{t("dictionary.filter.status_default")}</option>
          <option value="draft">{t("dictionary.filter.status_drafts")}</option>
          <option value="approved">{t("dictionary.filter.status_approved")}</option>
        </Select>
        <Select
          value={sort}
          onChange={(v) => setSort(v)}
          aria-label={t("dictionary.filter.sort_aria")}
        >
          <option value="alpha">{t("dictionary.filter.sort_alpha")}</option>
          <option value="newest">{t("dictionary.filter.sort_newest")}</option>
          <option value="updated">{t("dictionary.filter.sort_updated")}</option>
          <option value="needs_revision">{t("dictionary.filter.sort_needs_revision")}</option>
        </Select>
      </div>

      {!data || data.items.length === 0 ? (
        <EmptyState
          title={
            q || pos || source || status ? t("dictionary.empty.filtered_title") : t("dictionary.empty.title")
          }
          body={
            q || pos || source || status
              ? t("dictionary.empty.filtered_body")
              : canWrite
                ? t("dictionary.empty.body_writer")
                : t("dictionary.empty.body_viewer")
          }
          action={
            canWrite && !q && !pos && !source && !status ? (
              <Button onClick={() => setEditing("new")}>
                {t("dictionary.empty.add_first")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("dashboard.table.language_word")}</th>
                  <th>{t("dictionary.table.bengali_reference")}</th>
                  <th>{t("dictionary.table.english_reference")}</th>
                  <th>{t("dictionary.table.parts_of_speech")}</th>
                  <th>{t("dashboard.table.pronunciation")}</th>
                  <th>{t("dictionary.table.status")}</th>
                  <th>{t("dictionary.table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <div className="mono">
                        <strong>{e.word}</strong>
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <SourceBadge source={e.source} />
                      </div>
                    </td>
                    <td className="bn" lang="bn">{e.bengaliMeaning || ""}</td>
                    <td>{e.englishMeaning || ""}</td>
                    <td>
                      <Badge tone="navy">{e.partOfSpeech}</Badge>
                    </td>
                    <td className="bilingual">{e.pronunciationGuide || ""}</td>
                    <td>
                      <StatusBadge status={e.status} />
                    </td>
                    <td>
                      {canWrite && (
                        <div style={{ display: "flex", gap: 4 }}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="btn-icon"
                            onClick={() => setEditing(e)}
                            aria-label={t("dictionary.edit.aria", { word: e.word })}
                          >
                            <Pencil size={14} />
                          </Button>
                          <ArchiveButton
                            workspaceId={workspace.id}
                            entry={e}
                            onDone={load}
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && totalPages > 1 && (
        <div className="pagination">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            {t("common.previous")}
          </Button>
          <span>
            {t("common.page_x_of_y", { page: data.page, total: totalPages })} · {t("dictionary.pagination.words", { count: data.total })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            {t("common.next")}
          </Button>
        </div>
      )}

      {editing && (
        <EditDialog
          workspaceId={workspace.id}
          entry={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}

      {ioOpen === "export" && (
        <ExportDialog
          workspaceId={workspace.id}
          onClose={() => setIoOpen(null)}
        />
      )}
      {ioOpen === "import" && (
        <ImportDialog
          workspaceId={workspace.id}
          onClose={() => setIoOpen(null)}
          onImported={load}
        />
      )}
    </div>
  );
}

/* --------------------------------- add / edit -------------------------------- */

function EditDialog({
  workspaceId,
  entry,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  entry: EntryDTO | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(
    entry ? formFromEntry(entry) : EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const firstInput = useRef<HTMLInputElement>(null);

  useEffect(() => firstInput.current?.focus(), []);

  const set =
    (key: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (entry) {
        await api.patch(
          `/api/ws/${workspaceId}/dictionary/${entry.id}`,
          payloadFromForm(form),
        );
        toast.success(t("dictionary.toast.updated", { word: form.word }));
      } else {
        await api.post(
          `/api/ws/${workspaceId}/dictionary`,
          payloadFromForm(form),
        );
        toast.success(t("dictionary.toast.added", { word: form.word }));
      }
      await onSaved();
    } catch (err) {
      setError(describeApiError(err, t("dictionary.save_error")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={entry ? t("dictionary.edit.title_existing", { word: entry.word }) : t("dictionary.edit.title_new")}
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} noValidate>
        <div className="form-row">
          <Field label={t("dictionary.edit.word_label")}>
            <Input
              ref={firstInput}
              value={form.word}
              onChange={set("word")}
              required
              maxLength={80}
              placeholder={t("dictionary.edit.word_placeholder")}
            />
          </Field>
          <Field label={t("dictionary.edit.pos_label")}>
            <Select
              value={form.partOfSpeech}
              onChange={(v) => setForm((f) => ({ ...f, partOfSpeech: v }))}
            >
              {PARTS_OF_SPEECH.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="form-row">
          <Field label={t("dictionary.edit.bengali_label")}>
            <Input
              value={form.bengaliMeaning}
              onChange={set("bengaliMeaning")}
              maxLength={200}
              placeholder={t("dictionary.edit.bengali_placeholder")}
            />
          </Field>
          <Field label={t("dictionary.edit.english_label")}>
            <Input
              value={form.englishMeaning}
              onChange={set("englishMeaning")}
              maxLength={200}
              placeholder={t("dictionary.edit.english_placeholder")}
            />
          </Field>
        </div>
        <div className="form-row">
          <Field label={t("dictionary.edit.pronunciation_label")} hint={t("dictionary.edit.pronunciation_hint")}>
            <Input
              value={form.pronunciationGuide}
              onChange={set("pronunciationGuide")}
              maxLength={120}
            />
          </Field>
          <Field label={t("dictionary.edit.ipa_label")}>
            <Input value={form.ipa} onChange={set("ipa")} maxLength={120} />
          </Field>
        </div>
        <Field label={t("dictionary.edit.root_label")}>
          <Input
            value={form.root}
            onChange={set("root")}
            maxLength={120}
            placeholder={t("dictionary.edit.root_placeholder")}
          />
        </Field>
        <Field
          label={t("dictionary.edit.examples_label")}
          hint={t("dictionary.edit.examples_hint")}
        >
          <Textarea
            value={form.examplesText}
            onChange={set("examplesText")}
            rows={3}
            placeholder={t("dictionary.edit.examples_placeholder")}
          />
        </Field>
        <div className="form-row">
          <Field label={t("dictionary.edit.grammar_label")}>
            <Input
              value={form.grammarNotes}
              onChange={set("grammarNotes")}
              maxLength={600}
            />
          </Field>
          <Field label={t("dictionary.edit.mnemonic_label")}>
            <Input
              value={form.mnemonic}
              onChange={set("mnemonic")}
              maxLength={400}
            />
          </Field>
        </div>
        <ErrorNote message={error} />
        <div className="modal-actions">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            disabled={busy || form.word.trim().length === 0}
          >
            {busy ? t("common.saving") : entry ? t("dictionary.edit.save_changes") : t("dictionary.edit.add_word")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------------------------- archive ---------------------------------- */

function ArchiveButton({
  workspaceId,
  entry,
  onDone,
}: {
  workspaceId: string;
  entry: EntryDTO;
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const act = async () => {
    setBusy(true);
    try {
      if (entry.archived) {
        await api.post(`/api/ws/${workspaceId}/dictionary/${entry.id}/restore`);
        toast(t("dictionary.toast.restored", { word: entry.word }));
      } else {
        await api.del(`/api/ws/${workspaceId}/dictionary/${entry.id}`);
        toast(t("dictionary.toast.archived", { word: entry.word }));
      }
      await onDone();
    } catch (err) {
      toast.error(describeApiError(err, t("dictionary.toast.action_failed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className="btn-icon"
      onClick={act}
      disabled={busy}
      aria-label={
        entry.archived ? t("dictionary.restore.aria", { word: entry.word }) : t("dictionary.archive.aria", { word: entry.word })
      }
    >
      {entry.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
    </Button>
  );
}

/* ------------------------------ import / export ------------------------------ */

function ExportDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  return (
    <Modal title={t("dictionary.export.title")} onClose={onClose}>
      <p className="bilingual">
        {t("dictionary.export.body")}
      </p>
      <button
        className="modal-option"
        onClick={() =>
          void downloadFile(
            `/api/ws/${workspaceId}/dictionary/export?format=csv`,
          )
        }
      >
        <FileSpreadsheet size={18} aria-hidden="true" />
        <span className="modal-option-text">
          <span className="modal-option-title">CSV</span>
          <span className="modal-option-sub">
            {t("dictionary.export.csv_sub")}
          </span>
        </span>
        <Download
          size={15}
          aria-hidden="true"
          className="modal-option-action"
        />
      </button>
      <button
        className="modal-option"
        onClick={() =>
          void downloadFile(
            `/api/ws/${workspaceId}/dictionary/export?format=json`,
          )
        }
      >
        <Braces size={18} aria-hidden="true" />
        <span className="modal-option-text">
          <span className="modal-option-title">JSON</span>
          <span className="modal-option-sub">
            {t("dictionary.export.json_sub")}
          </span>
        </span>
        <Download
          size={15}
          aria-hidden="true"
          className="modal-option-action"
        />
      </button>
    </Modal>
  );
}

function ImportDialog({
  workspaceId,
  onClose,
  onImported,
}: {
  workspaceId: string;
  onClose: () => void;
  onImported: () => Promise<void>;
}) {
  const [report, setReport] = useState<ImportReport | null>(null);
  const [rows, setRows] = useState<Array<Record<string, string>>>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const downloadTemplate = async () => {
    const res = await api.get<{ headers: string[] }>(
      `/api/ws/${workspaceId}/dictionary/template`,
    );
    const csv =
      res.headers.join(",") +
      "\nvethra,চুক্তি,agreement,,,noun,,,\nsolven,গোপনীয়,confidential,,,adjective,,,\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lexora-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (file: File) => {
    setError(null);
    setReport(null);
    setRows([]);
    setFileName(file.name);
    const content = await file.text();
    const format = file.name.toLowerCase().endsWith(".json") ? "json" : "csv";
    setBusy(true);
    try {
      const res = await api.post<{ report: ImportReport }>(
        `/api/ws/${workspaceId}/dictionary/import/preview`,
        { format, content },
      );
      setReport(res.report);
      setRows(res.report.rows);
    } catch (err) {
      setError(describeApiError(err, t("dictionary.import.read_error")));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    setBusy(true);
    try {
      const res = await api.post<{
        imported: number;
        skippedDuplicates: number;
      }>(`/api/ws/${workspaceId}/dictionary/import/commit`, { rows });
      toast.success(
        t(
          res.imported === 1
            ? "dictionary.import.toast_one"
            : "dictionary.import.toast_many",
          { count: res.imported },
        ) + (res.skippedDuplicates > 0 ? t("dictionary.import.toast_skipped", { count: res.skippedDuplicates }) : "") + ".",
      );
      await onImported();
      onClose();
    } catch (err) {
      setError(describeApiError(err, t("dictionary.import.failed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t("dictionary.import.title")} onClose={onClose}>
      <p className="bilingual">
        {t("dictionary.import.body_prefix")} <code>word</code> {t("dictionary.import.body_suffix")}{" "}
        <button className="btn btn-ghost btn-sm" onClick={downloadTemplate}>
          {t("dictionary.import.template_link")}
        </button>
        .
      </p>
      <div
        className={`dropzone${dragOver ? " over" : ""}`}
        role="button"
        tabIndex={0}
        aria-label={t("dictionary.import.dropzone_aria")}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void onFile(file);
        }}
      >
        <Upload size={20} aria-hidden="true" />
        <div>
          <strong>{t("dictionary.import.dropzone_text")}</strong> {t("dictionary.import.dropzone_or")}
        </div>
        <span className="field-hint">{t("dictionary.import.dropzone_hint")}</span>
      </div>
      <Input
        ref={fileInputRef}
        type="file"
        accept=".csv,.json,text/csv,application/json"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset so picking the same file again still fires change.
          e.target.value = "";
          if (file) void onFile(file);
        }}
      />
      {fileName && <p className="field-hint">{fileName}</p>}

      {busy && <Spinner />}
      <ErrorNote message={error} />

      {report && (
        <div style={{ marginTop: 16 }}>
          <h3>{t("dictionary.import.preview_title")}</h3>
          <div
            className="metrics"
            style={{ gridTemplateColumns: "repeat(4, 1fr)", margin: "12px 0" }}
          >
            <div className="stat">
              <div className="stat-value">{report.validCount}</div>
              <div className="stat-label">{t("dictionary.import.stat_ready")}</div>
            </div>
            <div className="stat">
              <div className="stat-value">{report.duplicatesInFile.length}</div>
              <div className="stat-label">{t("dictionary.import.stat_duplicates")}</div>
            </div>
            <div className="stat">
              <div className="stat-value">
                {report.duplicatesInDictionary.length}
              </div>
              <div className="stat-label">{t("dictionary.import.stat_existing")}</div>
            </div>
            <div className="stat">
              <div className="stat-value">{report.invalid.length}</div>
              <div className="stat-label">{t("dictionary.import.stat_invalid")}</div>
            </div>
          </div>
          {report.invalid.slice(0, 5).map((i) => (
            <p key={i.row} className="error-text">
              {t("dictionary.import.invalid_row", { row: i.row, word: i.word, issues: i.issues.join(", ") })}
            </p>
          ))}
          {report.warnings.slice(0, 3).map((w, i) => (
            <p key={i} className="bilingual">
              {w}
            </p>
          ))}
          <div className="modal-actions">
            <Button variant="outline" onClick={onClose}>
              {t("common.close")}
            </Button>
            <Button onClick={commit} disabled={busy || report.validCount === 0}>
              {t("dictionary.import.commit", { count: report.validCount })}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
