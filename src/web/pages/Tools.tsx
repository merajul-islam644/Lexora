import { useEffect, useState } from "react";
import { Check, Lightbulb } from "lucide-react";
import { api, PARTS_OF_SPEECH } from "../api.js";
import { useToast } from "../state.js";
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

export function WordBuilder({ workspace }: { workspace: Workspace }) {
  const [concept, setConcept] = useState("");
  const [pos, setPos] = useState("noun");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    document.title = "Word Builder — Lexora";
  }, []);

  const suggest = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuggestion(null);
    try {
      const res = await api.post<{ suggestion: Suggestion }>(`/api/ws/${workspace.id}/word-builder/suggest`, { concept, partOfSpeech: pos });
      setSuggestion(res.suggestion);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build a suggestion");
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!suggestion) return;
    setBusy(true);
    try {
      const res = await api.post<{ word: string }>(`/api/ws/${workspace.id}/word-builder/approve`, {
        word: suggestion.word,
        bengaliMeaning: suggestion.bengaliMeaning,
        englishMeaning: suggestion.englishMeaning || concept,
        pronunciationGuide: suggestion.pronunciationGuide,
        partOfSpeech: suggestion.partOfSpeech,
        root: suggestion.root,
        wordFormationExplanation: suggestion.formation
      });
      toast(`"${res.word}" added to the dictionary as a generated word.`, "success");
      setSuggestion(null);
      setConcept("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the word");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Word Builder"
        subtitle="Coin new words that follow your language's sound and derivation rules."
      />
      <div className="wb-grid">
        <form className="card" onSubmit={suggest} noValidate>
          <Field label="Concept" hint="English or বাংলা — the meaning you want a word for.">
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
          {error && <p className="error-text" role="alert" style={{ marginTop: 10 }}>{error}</p>}
        </form>

        <div>
          {suggestion && (
            <div className="card">
              <div className="card-title">
                <h3 style={{ fontSize: 24 }} className="mono">{suggestion.word}</h3>
                {suggestion.kind === "existing" ? <Badge tone="teal">Already in your dictionary</Badge> : <Badge tone="violet">New suggestion</Badge>}
              </div>
              <p className="bilingual">{suggestion.pronunciationGuide} {suggestion.ipa}</p>
              <p>
                <strong>{suggestion.englishMeaning || concept}</strong>
                {suggestion.bengaliMeaning && <> · <span className="bn">{suggestion.bengaliMeaning}</span></>} · {suggestion.partOfSpeech}
              </p>
              {suggestion.formation && (
                <p className="bilingual">
                  <Lightbulb size={13} style={{ verticalAlign: -2 }} /> {suggestion.formation}
                </p>
              )}
              {suggestion.relatedWords.length > 0 && (
                <p className="bilingual">
                  Related: {suggestion.relatedWords.map((r) => `${r.word} (${r.meaning})`).join(", ")}
                </p>
              )}
              {suggestion.kind === "suggestion" ? (
                <Button onClick={approve} disabled={busy}>
                  <Check size={15} /> {busy ? "Saving…" : "Approve & add to dictionary"}
                </Button>
              ) : (
                <p className="notice-plain">This meaning already has a word — no need to invent a rival.</p>
              )}
            </div>
          )}

          {!suggestion && !busy && (
            <div className="card">
              <EmptyState
                title="Suggest your first word"
                body="The builder proposes a word consistent with your generated phonology and derivation rules, checks for collisions, and explains its reasoning."
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
  const toast = useToast();

  useEffect(() => {
    document.title = "Translation Lab — Lexora";
  }, []);

  const translate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.post<TranslationResult>(`/api/ws/${workspace.id}/translate`, { text, from, to });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Translation failed");
    } finally {
      setBusy(false);
    }
  };

  const saveToPhrasebook = async () => {
    if (!result) return;
    try {
      await api.post(`/api/ws/${workspace.id}/phrasebook`, { sourceText: text, sourceLang: from, translatedText: result.translation, targetLang: to });
      setPhrasebookKey((k) => k + 1);
      toast("Saved to your phrasebook.", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save", "error");
    }
  };

  const label = (v: string) => LANGS.find((l) => l.value === v)?.label ?? v;

  return (
    <div>
      <PageHeader title="Translation Lab" subtitle="Draft translations built from your own dictionary — word by word, with nothing hidden." />
      <div className="info-note" role="note">
        Every result is a <strong>draft</strong> assembled by rules from your dictionary, not fluent machine translation.
        Anything the dictionary doesn't cover appears in brackets.
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
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">
            <h3>Result</h3>
            <Badge tone="amber">Draft · {Math.round(result.confidence * 100)}% coverage</Badge>
          </div>
          <p style={{ fontSize: 19, fontWeight: 600 }}>{result.translation || <span className="bilingual">Nothing could be translated.</span>}</p>
          {result.ruleReferences.length > 0 && (
            <p className="bilingual">Applied rules: {result.ruleReferences.join(", ")}</p>
          )}

          {result.mapping.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 12 }}>
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
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <Button variant="outline" onClick={saveToPhrasebook}>Save to phrasebook</Button>
            {result.unmapped.length > 0 && (
              <span className="bilingual" style={{ alignSelf: "center" }}>
                Not in your dictionary yet: {result.unmapped.join(", ")} — add them or use the Word Builder.
              </span>
            )}
          </div>
        </div>
      )}

      <Phrasebook key={phrasebookKey} workspaceId={workspace.id} />
    </div>
  );
}

function Phrasebook({ workspaceId }: { workspaceId: string }) {
  const [items, setItems] = useState<Array<{ id: string; sourceText: string; sourceLang: string; translatedText: string; targetLang: string }>>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void api.get<{ items: typeof items }>(`/api/ws/${workspaceId}/phrasebook`).then((r) => {
      setItems(r.items);
      setLoaded(true);
    });
  }, [workspaceId]);

  const remove = async (id: string) => {
    await api.del(`/api/ws/${workspaceId}/phrasebook/${id}`);
    setItems((list) => list.filter((i) => i.id !== id));
  };

  if (!loaded) return <LoadingScreen />;
  if (items.length === 0) return null;

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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>{i.sourceText}</td>
                <td><strong>{i.translatedText}</strong></td>
                <td>
                  <Button variant="ghost" size="sm" onClick={() => void remove(i.id)}>Remove</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
