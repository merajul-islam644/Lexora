import { useEffect, useState } from "react";
import { Check, Lightbulb, Copy, Flag, NotebookPen, X } from "lucide-react";
import { api, PARTS_OF_SPEECH } from "../api.js";
import { describeApiError } from "../errors.js";
import { toast } from "sonner";
import { Badge, Button, EmptyState, Field, LoadingScreen, PageHeader, Select, Textarea } from "../ui.js";

type Workspace = { id: string; name: string; role: string };

interface Suggestion {
  kind: "suggestion" | "existing";
  word: string;
  bengaliMeaning: string;
  englishMeaning: string;
  pronunciationGuide: string;
  ipa: string;
  partOfSpeech: string;
  root: string;
  formation: string;
  relatedWords: Array<{ word: string; meaning: string }>;
  ruleReference: string;
  existingEntryId?: string;
}

interface Affixes {
  plural: string;
  past: string;
  future: string;
  negation: string;
  question: string;
  genitive: string;
  formal: string;
}

interface EditableWord {
  word: string;
  bengaliMeaning: string;
  englishMeaning: string;
  pronunciationGuide: string;
  partOfSpeech: string;
  root: string;
  formation: string;
  mnemonic: string;
}

export function WordBuilder({ workspace }: { workspace: Workspace }) {
  const [concept, setConcept] = useState("");
  const [pos, setPos] = useState("noun");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [form, setForm] = useState<EditableWord | null>(null);
  const [affixes, setAffixes] = useState<Affixes | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Word Builder · Lexora";
    // The derived-form previews come from the language's inflectional affixes;
    // a workspace without a language simply has none.
    api
      .get<{ affixes: Affixes | null }>(`/api/ws/${workspace.id}/language/grammar`)
      .then((r) => setAffixes(r.affixes))
      .catch(() => setAffixes(null));
  }, [workspace.id]);

  const suggest = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuggestion(null);
    setForm(null);
    try {
      const res = await api.post<{ suggestion: Suggestion }>(`/api/ws/${workspace.id}/word-builder/suggest`, { concept, partOfSpeech: pos });
      setSuggestion(res.suggestion);
      if (res.suggestion.kind === "suggestion") {
        // Everything lands in an editable form: the proposal is a draft to
        // correct, not a verdict (spec §12).
        setForm({
          word: res.suggestion.word,
          bengaliMeaning: res.suggestion.bengaliMeaning,
          englishMeaning: res.suggestion.englishMeaning || concept,
          pronunciationGuide: res.suggestion.pronunciationGuide,
          partOfSpeech: res.suggestion.partOfSpeech,
          root: res.suggestion.root,
          formation: res.suggestion.formation,
          mnemonic: "",
        });
      }
    } catch (err) {
      setError(describeApiError(err, "Could not build a suggestion"));
    } finally {
      setBusy(false);
    }
  };

  const discard = () => {
    setSuggestion(null);
    setForm(null);
    setError(null);
  };

  const approve = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const res = await api.post<{ word: string }>(`/api/ws/${workspace.id}/word-builder/approve`, {
        word: form.word,
        bengaliMeaning: form.bengaliMeaning,
        englishMeaning: form.englishMeaning || concept,
        pronunciationGuide: form.pronunciationGuide,
        partOfSpeech: form.partOfSpeech,
        root: form.root,
        wordFormationExplanation: form.formation,
        mnemonic: form.mnemonic,
      });
      toast.success(`"${res.word}" added to the dictionary as a generated word.`);
      setSuggestion(null);
      setForm(null);
      setConcept("");
    } catch (err) {
      setError(describeApiError(err, "Could not save the word"));
    } finally {
      setBusy(false);
    }
  };

  // What the word would look like with the language's inflectional affixes.
  const previews: string[] = [];
  if (form && affixes) {
    if (affixes.plural) previews.push(`Plural: ${form.word}${affixes.plural}`);
    if (affixes.past && form.partOfSpeech === "verb") previews.push(`Past: ${form.word}${affixes.past}`);
    if (affixes.future && form.partOfSpeech === "verb") previews.push(`Future: ${form.word}${affixes.future}`);
  }

  return (
    <div>
      <PageHeader
        title="Word Builder"
        subtitle="Coin new words that follow your language's sound and derivation rules. Every suggestion is editable before it reaches the dictionary."
      />
      <div className="wb-grid">
        <form className="card" onSubmit={suggest} noValidate>
          <Field label="Concept" hint="English or বাংলা, the meaning you want a word for.">
            <input className="input" value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="e.g. deadline / শেষ সময়" required maxLength={200} />
          </Field>
          <Field label="Part of speech">
            <Select value={pos} onChange={(v) => setPos(v)}>
              {PARTS_OF_SPEECH.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </Select>
          </Field>
          <Button type="submit" disabled={busy || concept.trim().length === 0}>
            <Lightbulb size={15} /> {busy ? "Thinking…" : "Suggest a word"}
          </Button>
          {error && (
            <p className="notice-plain" role="alert" style={{ marginTop: 10 }}>{error}</p>
          )}
        </form>

        <div>
          {suggestion?.kind === "existing" && (
            <div className="card">
              <div className="card-title">
                <h3 style={{ fontSize: 24 }} className="mono">{suggestion.word}</h3>
                <Badge tone="teal">Already in your dictionary</Badge>
              </div>
              <p className="bilingual">{suggestion.pronunciationGuide} {suggestion.ipa}</p>
              <p>
                <strong>{suggestion.englishMeaning}</strong>
                {suggestion.bengaliMeaning && <> · <span className="bn" lang="bn">{suggestion.bengaliMeaning}</span></>} · {suggestion.partOfSpeech}
              </p>
              <p className="notice-plain">This meaning already has a word; no need to invent a rival.</p>
              <Button variant="outline" onClick={discard}>Try another concept</Button>
            </div>
          )}

          {suggestion?.kind === "suggestion" && form && (
            <div className="card">
              <div className="card-title">
                <h3>Edit before saving</h3>
                <Badge tone="violet">Draft proposal</Badge>
              </div>
              <p className="bilingual">
                <Lightbulb size={13} style={{ verticalAlign: -2 }} /> Why this shape: {suggestion.formation}
              </p>
              <p className="bilingual">Rule reference: <strong>{suggestion.ruleReference}</strong></p>
              {suggestion.relatedWords.length > 0 && (
                <p className="bilingual">
                  Related roots: {suggestion.relatedWords.map((r) => `${r.word} (${r.meaning})`).join(", ")}
                </p>
              )}
              {previews.length > 0 && (
                <p className="bilingual">With your language's affixes — {previews.join(" · ")}</p>
              )}

              <div style={{ display: "grid", gap: 10, margin: "14px 0" }}>
                <Field label="Word">
                  <input className="input mono" value={form.word} onChange={(e) => setForm({ ...form, word: e.target.value })} maxLength={80} />
                </Field>
                <div className="form-row">
                  <Field label="English meaning">
                    <input className="input" value={form.englishMeaning} onChange={(e) => setForm({ ...form, englishMeaning: e.target.value })} maxLength={200} />
                  </Field>
                  <Field label="Bengali meaning">
                    <input className="input" value={form.bengaliMeaning} onChange={(e) => setForm({ ...form, bengaliMeaning: e.target.value })} maxLength={200} />
                  </Field>
                </div>
                <div className="form-row">
                  <Field label="Pronunciation guide">
                    <input className="input" value={form.pronunciationGuide} onChange={(e) => setForm({ ...form, pronunciationGuide: e.target.value })} maxLength={120} />
                  </Field>
                  <Field label="Part of speech">
                    <Select value={form.partOfSpeech} onChange={(v) => setForm({ ...form, partOfSpeech: v })}>
                      {PARTS_OF_SPEECH.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <Field label="Root" hint="The base root this word was coined from.">
                  <input className="input mono" value={form.root} onChange={(e) => setForm({ ...form, root: e.target.value })} maxLength={120} />
                </Field>
                <Field label="Formation explanation">
                  <Textarea value={form.formation} onChange={(e) => setForm({ ...form, formation: e.target.value })} rows={2} maxLength={600} />
                </Field>
                <Field label="Mnemonic (optional)">
                  <input className="input" value={form.mnemonic} onChange={(e) => setForm({ ...form, mnemonic: e.target.value })} maxLength={400} />
                </Field>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Button onClick={() => void approve()} disabled={busy || form.word.trim().length === 0}>
                  <Check size={15} /> {busy ? "Saving…" : "Approve & add to dictionary"}
                </Button>
                <Button variant="outline" onClick={discard} disabled={busy}>
                  <X size={15} /> Discard
                </Button>
              </div>
            </div>
          )}

          {!suggestion && !busy && !error && (
            <div className="card">
              <EmptyState
                title="Suggest your first word"
                body="The builder proposes a word consistent with your generated phonology and derivation rules, checks for collisions, and explains its reasoning. You edit everything before saving."
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- translation lab ------------------------------ */

interface TranslationResult {
  translation: string;
  mapping: Array<{ source: string; target: string; meaning: string; note?: string }>;
  ruleReferences: string[];
  confidence: number;
  reviewStatus: "draft";
  alternatives: string[];
  unmapped: string[];
}

interface PhraseItem {
  id: string;
  sourceText: string;
  sourceLang: string;
  translatedText: string;
  targetLang: string;
  note: string;
}

const LANGS = [
  { value: "english", label: "English" },
  { value: "bengali", label: "বাংলা" },
  { value: "language", label: "Your language" }
];

export function TranslationLab({ workspace }: { workspace: Workspace }) {
  const [text, setText] = useState("");
  const [from, setFrom] = useState("english");
  const [to, setTo] = useState("language");
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phrasebookKey, setPhrasebookKey] = useState(0);
  // Save-to-phrasebook flow: an optional note travels with the phrase.
  const [saveNote, setSaveNote] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  // "Report incorrect" flow: optional reason, privacy-safe metadata only.
  const [flagReason, setFlagReason] = useState("");
  const [flagOpen, setFlagOpen] = useState(false);

  useEffect(() => {
    document.title = "Translation Lab · Lexora";
  }, []);

  const translate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    setSaveOpen(false);
    setFlagOpen(false);
    try {
      const res = await api.post<TranslationResult>(`/api/ws/${workspace.id}/translate`, { text, from, to });
      setResult(res);
    } catch (err) {
      setError(describeApiError(err, "Translation failed"));
    } finally {
      setBusy(false);
    }
  };

  const saveToPhrasebook = async () => {
    if (!result) return;
    try {
      await api.post(`/api/ws/${workspace.id}/phrasebook`, { sourceText: text, sourceLang: from, translatedText: result.translation, targetLang: to, note: saveNote });
      setPhrasebookKey((k) => k + 1);
      setSaveOpen(false);
      setSaveNote("");
      toast.success("Saved to your phrasebook.");
    } catch (err) {
      toast.error(describeApiError(err, "Could not save"));
    }
  };

  const flagResult = async () => {
    try {
      await api.post(`/api/ws/${workspace.id}/translate/flag`, { from, to, reason: flagReason });
      toast.success("Flagged. The audit entry records the direction and reason — never the text itself.");
      setFlagOpen(false);
      setFlagReason("");
    } catch (err) {
      toast.error(describeApiError(err, "Could not flag the translation"));
    }
  };

  const copyResult = async () => {
    try {
      await navigator.clipboard.writeText(result?.translation ?? "");
      toast.success("Translation copied.");
    } catch {
      toast.error("Clipboard is not available in this browser context.");
    }
  };

  const label = (v: string) => LANGS.find((l) => l.value === v)?.label ?? v;

  return (
    <div>
      <PageHeader title="Translation Lab" subtitle="Draft translations built from your own dictionary, word by word, with nothing hidden." />
      <div className="info-note" role="note">
        Every result is a <strong>draft</strong> assembled by rules from your dictionary, not fluent machine translation.
        Anything the dictionary doesn't cover appears in brackets. And it stays private: the whole process runs on your
        device against your workspace's own storage — no external translation service sees a word.
      </div>

      <div className="card">
        <form onSubmit={translate} noValidate>
          <div className="form-row" style={{ maxWidth: 420 }}>
            <Field label="From">
              <Select value={from} onChange={(v) => setFrom(v)}>
                {LANGS.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="To">
              <Select value={to} onChange={(v) => setTo(v)}>
                {LANGS.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Text">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="e.g. We will review the contract" maxLength={2000} required />
          </Field>
          {from === to && <p className="error-text">Choose two different languages.</p>}
          <Button type="submit" disabled={busy || from === to || text.trim().length === 0}>
            {busy ? "Translating…" : `Translate to ${label(to)}`}
          </Button>
        </form>
      </div>

      {result && (
        <div className="grid-3" style={{ marginTop: 16 }}>
          <div className="card">
            <div className="card-title">
              <h3>Source</h3>
              <Badge tone="gray">{label(from)}</Badge>
            </div>
            <p style={{ whiteSpace: "pre-wrap" }}>{text}</p>
          </div>

          <div className="card" aria-live="polite">
            <div className="card-title">
              <h3>Result</h3>
              <Badge tone="amber">Draft · {Math.round(result.confidence * 100)}% coverage</Badge>
            </div>
            <p style={{ fontSize: 18, fontWeight: 600, whiteSpace: "pre-wrap" }}>
              {result.translation || <span className="bilingual">Nothing could be translated.</span>}
            </p>
            <div style={{ display: "flex", gap: 10, margin: "10px 0", flexWrap: "wrap" }}>
              <Button variant="outline" size="sm" onClick={() => void copyResult()}>
                <Copy size={14} /> Copy
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSaveOpen((v) => !v)}>
                <NotebookPen size={14} /> Save to phrasebook
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setFlagOpen((v) => !v)}>
                <Flag size={14} /> Report incorrect
              </Button>
            </div>

            {saveOpen && (
              <div style={{ display: "grid", gap: 8, margin: "8px 0" }}>
                <input
                  className="input"
                  placeholder="Note (optional) — when/why you'd use this phrase"
                  value={saveNote}
                  onChange={(e) => setSaveNote(e.target.value)}
                  maxLength={400}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <Button size="sm" onClick={() => void saveToPhrasebook()}>Save</Button>
                  <Button variant="outline" size="sm" onClick={() => setSaveOpen(false)}>Cancel</Button>
                </div>
              </div>
            )}

            {flagOpen && (
              <div style={{ display: "grid", gap: 8, margin: "8px 0" }}>
                <input
                  className="input"
                  placeholder="What was wrong? (optional)"
                  value={flagReason}
                  onChange={(e) => setFlagReason(e.target.value)}
                  maxLength={400}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <Button size="sm" onClick={() => void flagResult()}>Send report</Button>
                  <Button variant="outline" size="sm" onClick={() => setFlagOpen(false)}>Cancel</Button>
                </div>
                <p className="bilingual">Your text itself is never stored in the report.</p>
              </div>
            )}

            {result.alternatives.length > 0 && (
              <p className="bilingual" style={{ marginTop: 8 }}>
                Try also: {result.alternatives.map((a, i) => (
                  <span key={i} className="chip" style={{ marginRight: 6 }}>{a}</span>
                ))}
              </p>
            )}
          </div>

          <div className="card">
            <div className="card-title">
              <h3>How it was built</h3>
              {result.unmapped.length > 0 && <Badge tone="red">{result.unmapped.length} unmapped</Badge>}
            </div>
            {result.ruleReferences.length > 0 && (
              <p className="bilingual">Applied rules: {result.ruleReferences.join(", ")}</p>
            )}
            {result.mapping.length > 0 ? (
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>{label(to)}</th>
                      <th>Meaning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.mapping.map((m, i) => (
                      <tr key={i}>
                        <td className="mono">{m.source}</td>
                        <td><strong>{m.target}</strong> {m.note && <span className="bilingual">({m.note})</span>}</td>
                        <td className="bilingual">{m.meaning}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="bilingual">No dictionary word matched anything in the source text.</p>
            )}
            {result.unmapped.length > 0 && (
              <p className="bilingual" style={{ marginTop: 8 }}>
                Not in your dictionary yet: {result.unmapped.join(", ")}; add them or use the Word Builder.
              </p>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="notice-plain" role="alert" style={{ marginTop: 12 }}>{error}</p>
      )}

      <Phrasebook key={phrasebookKey} workspaceId={workspace.id} />
    </div>
  );
}

function Phrasebook({ workspaceId }: { workspaceId: string }) {
  const [items, setItems] = useState<PhraseItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  useEffect(() => {
    void api
      .get<{ items: PhraseItem[] }>(`/api/ws/${workspaceId}/phrasebook`)
      .then((r) => {
        setItems(r.items);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [workspaceId]);

  const remove = async (id: string) => {
    try {
      await api.del(`/api/ws/${workspaceId}/phrasebook/${id}`);
      setItems((list) => list.filter((i) => i.id !== id));
      toast("Removed from the phrasebook.");
    } catch (err) {
      toast.error(describeApiError(err, "Could not remove the phrase"));
    }
  };

  const saveNote = async (id: string) => {
    try {
      await api.patch(`/api/ws/${workspaceId}/phrasebook/${id}`, { note: noteDraft });
      setItems((list) => list.map((i) => (i.id === id ? { ...i, note: noteDraft } : i)));
      setEditing(null);
      toast.success("Note saved.");
    } catch (err) {
      toast.error(describeApiError(err, "Could not save the note"));
    }
  };

  if (!loaded) return <LoadingScreen />;
  if (items.length === 0) {
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <EmptyState
          title="Your phrasebook is empty"
          body="Translate something and press “Save to phrasebook” — with an optional note about when to use it — and it will be waiting here."
        />
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-title">
        <h3>Saved phrases</h3>
        <span className="bilingual">Your workspace's quick-reference phrasebook.</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Original</th>
              <th>Translation</th>
              <th>Note</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>{i.sourceText}</td>
                <td><strong>{i.translatedText}</strong></td>
                <td className="bilingual">
                  {editing === i.id ? (
                    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <input
                        className="input"
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        maxLength={400}
                        placeholder="Add a note"
                      />
                      <Button size="sm" onClick={() => void saveNote(i.id)}>Save</Button>
                      <Button variant="outline" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                    </span>
                  ) : (
                    i.note || <span className="bilingual">—</span>
                  )}
                </td>
                <td>
                  <span style={{ display: "inline-flex", gap: 6 }}>
                    {editing !== i.id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditing(i.id);
                          setNoteDraft(i.note);
                        }}
                      >
                        Edit note
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => void remove(i.id)}>Remove</Button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
