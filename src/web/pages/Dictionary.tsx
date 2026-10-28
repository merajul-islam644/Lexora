import { useCallback, useEffect, useRef, useState } from "react";
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
import { useSession } from "../state.js";
import { toast } from "sonner";
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
  const [sort, setSort] = useState("alpha");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EntryDTO | "new" | null>(null);
  const [ioOpen, setIoOpen] = useState<"import" | "export" | null>(null);
  const { workspaces } = useSession();
  const role =
    workspaces.find((w) => w.id === workspace.id)?.role ?? workspace.role;
  const canWrite = role === "owner" || role === "admin" || role === "editor";

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
      const res = await api.get<ListResponse>(
        `/api/ws/${workspace.id}/dictionary?${params.toString()}`,
      );
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [workspace.id, page, q, pos, source, sort]);

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
        title="Dictionary"
        subtitle={`${data?.total ?? "…"} words · Bengali and English references are kept with every word.`}
        actions={
          <>
            {canWrite && (
              <Button variant="outline" onClick={() => setIoOpen("import")}>
                <FileUp size={15} /> Import
              </Button>
            )}
            <Button variant="outline" onClick={() => setIoOpen("export")}>
              <Download size={15} /> Export
            </Button>
            {canWrite && (
              <Button onClick={() => setEditing("new")}>
                <Plus size={15} /> Add word
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
            placeholder="Search word, Beng or English…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            style={{ paddingLeft: 32 }}
            aria-label="Search dictionary"
          />
        </div>
        <Select
          value={pos}
          onChange={(v) => {
            setPos(v);
            setPage(1);
          }}
          aria-label="Filter by part of speech"
        >
          <option value="">All parts of speech</option>
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
          aria-label="Filter by source"
        >
          <option value="">All sources</option>
          <option value="user">Your words</option>
          <option value="generated">Generated drafts</option>
          <option value="imported">Imported</option>
        </Select>
        <Select
          value={sort}
          onChange={(v) => setSort(v)}
          aria-label="Sort order"
        >
          <option value="alpha">A → Z</option>
          <option value="newest">Newest first</option>
          <option value="updated">Recently updated</option>
          <option value="needs_revision">Needs revision first</option>
        </Select>
      </div>

      {!data || data.items.length === 0 ? (
        <EmptyState
          title={
            q || pos || source ? "No words match" : "Your dictionary is empty"
          }
          body={
            q || pos || source
              ? "Try a different search or filter."
              : canWrite
                ? "Add your first word. It only needs the word itself, but a বাংলা or English reference makes generation much better."
                : "An editor hasn't added words yet."
          }
          action={
            canWrite && !q && !pos && !source ? (
              <Button onClick={() => setEditing("new")}>
                Add your first word
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
                  <th>Language word</th>
                  <th>Bengali reference</th>
                  <th>English reference</th>
                  <th>Parts of speech</th>
                  <th>Pronounciation</th>
                  <th>Status</th>
                  <th>Actions</th>
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
                    <td className="bn">{e.bengaliMeaning || ""}</td>
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
                            aria-label={`Edit ${e.word}`}
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
            Previous
          </Button>
          <span>
            Page {data.page} of {totalPages} · {data.total} words
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next
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
        toast.success(`"${form.word}" updated.`);
      } else {
        await api.post(
          `/api/ws/${workspaceId}/dictionary`,
          payloadFromForm(form),
        );
        toast.success(`"${form.word}" added to your dictionary.`);
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the word");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={entry ? `Edit "${entry.word}"` : "Add a word"}
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} noValidate>
        <div className="form-row">
          <Field label="Constructed word">
            <Input
              ref={firstInput}
              value={form.word}
              onChange={set("word")}
              required
              maxLength={80}
              placeholder="e.g. vethra"
            />
          </Field>
          <Field label="Part of speech">
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
          <Field label="বাংলা reference">
            <Input
              value={form.bengaliMeaning}
              onChange={set("bengaliMeaning")}
              maxLength={200}
              placeholder="e.g. চুক্তি"
            />
          </Field>
          <Field label="English reference">
            <Input
              value={form.englishMeaning}
              onChange={set("englishMeaning")}
              maxLength={200}
              placeholder="e.g. agreement"
            />
          </Field>
        </div>
        <div className="form-row">
          <Field label="Pronunciation guide" hint="e.g. VEH-thrah">
            <Input
              value={form.pronunciationGuide}
              onChange={set("pronunciationGuide")}
              maxLength={120}
            />
          </Field>
          <Field label="IPA">
            <Input value={form.ipa} onChange={set("ipa")} maxLength={120} />
          </Field>
        </div>
        <Field label="Root / formation notes">
          <Input
            value={form.root}
            onChange={set("root")}
            maxLength={120}
            placeholder="e.g. veth + -ra"
          />
        </Field>
        <Field
          label="Example sentences"
          hint="One per line: constructed | english | bengali"
        >
          <Textarea
            value={form.examplesText}
            onChange={set("examplesText")}
            rows={3}
            placeholder={
              "vethra kairum et | We approve the agreement | আমরা চুক্তিটি অনুমোদন করি"
            }
          />
        </Field>
        <div className="form-row">
          <Field label="Grammar notes">
            <Input
              value={form.grammarNotes}
              onChange={set("grammarNotes")}
              maxLength={600}
            />
          </Field>
          <Field label="Mnemonic">
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
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={busy || form.word.trim().length === 0}
          >
            {busy ? "Saving…" : entry ? "Save changes" : "Add word"}
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
        toast(`"${entry.word}" restored.`);
      } else {
        await api.del(`/api/ws/${workspaceId}/dictionary/${entry.id}`);
        toast(`"${entry.word}" archived.`);
      }
      await onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
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
        entry.archived ? `Restore ${entry.word}` : `Archive ${entry.word}`
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
    <Modal title="Export dictionary" onClose={onClose}>
      <p className="bilingual">
        Download the whole dictionary (archived words excluded). Exports are
        recorded in your activity log.
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
            Opens in Excel or Google Sheets
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
            Every field, best for backups and re-import
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
      setError(err instanceof Error ? err.message : "Could not read the file");
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
        `Imported ${res.imported} word${res.imported === 1 ? "" : "s"}${res.skippedDuplicates > 0 ? `, skipped ${res.skippedDuplicates} duplicates` : ""}.`,
      );
      await onImported();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Import words" onClose={onClose}>
      <p className="bilingual">
        CSV or JSON. CSV needs a <code>word</code> column;{" "}
        <button className="btn btn-ghost btn-sm" onClick={downloadTemplate}>
          download the template
        </button>
        .
      </p>
      <div
        className={`dropzone${dragOver ? " over" : ""}`}
        role="button"
        tabIndex={0}
        aria-label="Choose a CSV or JSON file, or drop one here"
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
          <strong>Choose a file</strong> or drop it here
        </div>
        <span className="field-hint">.csv or .json</span>
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
          <h3>Preview</h3>
          <div
            className="metrics"
            style={{ gridTemplateColumns: "repeat(4, 1fr)", margin: "12px 0" }}
          >
            <div className="stat">
              <div className="stat-value">{report.validCount}</div>
              <div className="stat-label">Ready to import</div>
            </div>
            <div className="stat">
              <div className="stat-value">{report.duplicatesInFile.length}</div>
              <div className="stat-label">Duplicates in file</div>
            </div>
            <div className="stat">
              <div className="stat-value">
                {report.duplicatesInDictionary.length}
              </div>
              <div className="stat-label">Already in dictionary</div>
            </div>
            <div className="stat">
              <div className="stat-value">{report.invalid.length}</div>
              <div className="stat-label">Invalid rows</div>
            </div>
          </div>
          {report.invalid.slice(0, 5).map((i) => (
            <p key={i.row} className="error-text">
              Row {i.row} "{i.word}": {i.issues.join(", ")}
            </p>
          ))}
          {report.warnings.slice(0, 3).map((w, i) => (
            <p key={i} className="bilingual">
              {w}
            </p>
          ))}
          <div className="modal-actions">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button onClick={commit} disabled={busy || report.validCount === 0}>
              Import {report.validCount} word
              {report.validCount === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
