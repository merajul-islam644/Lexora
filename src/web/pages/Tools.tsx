import { useEffect, useState } from "react";
import { Check, Lightbulb, Copy, Flag, NotebookPen, X } from "lucide-react";
import { api, PARTS_OF_SPEECH } from "../api.js";
import { describeApiError } from "../errors.js";
import { toast } from "sonner";
import { Badge, Button, EmptyState, Field, LoadingScreen, PageHeader, Select, Textarea } from "../ui.js";
import { t } from "../i18n/index.js";

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
      setError(describeApiError(err, t("tools.wb.suggest_error")));
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
      toast.success(t("tools.wb.toast_added", { word: res.word }));
      setSuggestion(null);
      setForm(null);
      setConcept("");
    } catch (err) {
      setError(describeApiError(err, t("tools.wb.save_error")));
    } finally {
      setBusy(false);
    }
  };

  // What the word would look like with the language's inflectional affixes.
  const previews: string[] = [];
  if (form && affixes) {
    if (affixes.plural) previews.push(t("tools.wb.preview_plural", { form: form.word + affixes.plural }));
    if (affixes.past && form.partOfSpeech === "verb") previews.push(t("tools.wb.preview_past", { form: form.word + affixes.past }));
    if (affixes.future && form.partOfSpeech === "verb") previews.push(t("tools.wb.preview_future", { form: form.word + affixes.future }));
  }

  return (
    <div>
      <PageHeader
        title={t("tools.wb.title")}
        subtitle={t("tools.wb.subtitle")}
      />
      <div className="wb-grid">
        <form className="card" onSubmit={suggest} noValidate>
          <Field label={t("tools.wb.concept_label")} hint={t("tools.wb.concept_hint")}>
            <input className="input" value={concept} onChange={(e) => setConcept(e.target.value)} placeholder={t("tools.wb.concept_placeholder")} required maxLength={200} />
          </Field>
          <Field label={t("tools.wb.pos_label")}>
            <Select value={pos} onChange={(v) => setPos(v)}>
              {PARTS_OF_SPEECH.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </Select>
          </Field>
          <Button type="submit" disabled={busy || concept.trim().length === 0}>
            <Lightbulb size={15} /> {busy ? t("tools.wb.thinking") : t("tools.wb.suggest")}
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
                <Badge tone="teal">{t("tools.wb.existing_badge")}</Badge>
              </div>
              <p className="bilingual">{suggestion.pronunciationGuide} {suggestion.ipa}</p>
              <p>
                <strong>{suggestion.englishMeaning}</strong>
                {suggestion.bengaliMeaning && <> · <span className="bn" lang="bn">{suggestion.bengaliMeaning}</span></>} · {suggestion.partOfSpeech}
              </p>
              <p className="notice-plain">{t("tools.wb.existing_note")}</p>
              <Button variant="outline" onClick={discard}>{t("tools.wb.try_another")}</Button>
            </div>
          )}

          {suggestion?.kind === "suggestion" && form && (
            <div className="card">
              <div className="card-title">
                <h3>{t("tools.wb.edit_title")}</h3>
                <Badge tone="violet">{t("tools.wb.draft_badge")}</Badge>
              </div>
              <p className="bilingual">
                <Lightbulb size={13} style={{ verticalAlign: -2 }} /> {t("tools.wb.why_shape", { formation: suggestion.formation })}
              </p>
              <p className="bilingual">{t("tools.wb.rule_reference")} <strong>{suggestion.ruleReference}</strong></p>
              {suggestion.relatedWords.length > 0 && (
                <p className="bilingual">
                  {t("tools.wb.related_roots", { roots: suggestion.relatedWords.map((r) => `${r.word} (${r.meaning})`).join(", ") })}
                </p>
              )}
              {previews.length > 0 && (
                <p className="bilingual">{t("tools.wb.affix_preview", { previews: previews.join(" · ") })}</p>
              )}

              <div style={{ display: "grid", gap: 10, margin: "14px 0" }}>
                <Field label={t("tools.wb.word_label")}>
                  <input className="input mono" value={form.word} onChange={(e) => setForm({ ...form, word: e.target.value })} maxLength={80} />
                </Field>
                <div className="form-row">
                  <Field label={t("tools.wb.english_label")}>
                    <input className="input" value={form.englishMeaning} onChange={(e) => setForm({ ...form, englishMeaning: e.target.value })} maxLength={200} />
                  </Field>
                  <Field label={t("tools.wb.bengali_label")}>
                    <input className="input" value={form.bengaliMeaning} onChange={(e) => setForm({ ...form, bengaliMeaning: e.target.value })} maxLength={200} />
                  </Field>
                </div>
                <div className="form-row">
                  <Field label={t("tools.wb.pronunciation_label")}>
                    <input className="input" value={form.pronunciationGuide} onChange={(e) => setForm({ ...form, pronunciationGuide: e.target.value })} maxLength={120} />
                  </Field>
                  <Field label={t("tools.wb.pos_label")}>
                    <Select value={form.partOfSpeech} onChange={(v) => setForm({ ...form, partOfSpeech: v })}>
                      {PARTS_OF_SPEECH.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <Field label={t("tools.wb.root_label")} hint={t("tools.wb.root_hint")}>
                  <input className="input mono" value={form.root} onChange={(e) => setForm({ ...form, root: e.target.value })} maxLength={120} />
                </Field>
                <Field label={t("tools.wb.formation_label")}>
                  <Textarea value={form.formation} onChange={(e) => setForm({ ...form, formation: e.target.value })} rows={2} maxLength={600} />
                </Field>
                <Field label={t("tools.wb.mnemonic_label")}>
                  <input className="input" value={form.mnemonic} onChange={(e) => setForm({ ...form, mnemonic: e.target.value })} maxLength={400} />
                </Field>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Button onClick={() => void approve()} disabled={busy || form.word.trim().length === 0}>
                  <Check size={15} /> {busy ? t("tools.wb.saving") : t("tools.wb.approve")}
                </Button>
                <Button variant="outline" onClick={discard} disabled={busy}>
                  <X size={15} /> {t("tools.wb.discard")}
                </Button>
              </div>
            </div>
          )}

          {!suggestion && !busy && !error && (
            <div className="card">
              <EmptyState
                title={t("tools.wb.empty_title")}
                body={t("tools.wb.empty_body")}
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
  { value: "english", labelKey: "tools.tl.lang_english" },
  { value: "bengali", labelKey: "tools.tl.lang_bengali" },
  { value: "language", labelKey: "tools.tl.lang_yours" }
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
      setError(describeApiError(err, t("tools.tl.translate_failed")));
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
      toast.success(t("tools.tl.save_done"));
    } catch (err) {
      toast.error(describeApiError(err, t("tools.tl.save_failed")));
    }
  };

  const flagResult = async () => {
    try {
      await api.post(`/api/ws/${workspace.id}/translate/flag`, { from, to, reason: flagReason });
      toast.success(t("tools.tl.flag_done"));
      setFlagOpen(false);
      setFlagReason("");
    } catch (err) {
      toast.error(describeApiError(err, t("tools.tl.flag_failed")));
    }
  };

  const copyResult = async () => {
    try {
      await navigator.clipboard.writeText(result?.translation ?? "");
      toast.success(t("tools.tl.copy_done"));
    } catch {
      toast.error(t("tools.tl.copy_failed"));
    }
  };

  const label = (v: string) => {
    const found = LANGS.find((l) => l.value === v);
    return found ? t(found.labelKey) : v;
  };

  return (
    <div>
      <PageHeader title={t("tools.tl.title")} subtitle={t("tools.tl.subtitle")} />
      <div className="info-note" role="note">
        {t("tools.tl.disclosure_prefix")} <strong>{t("tools.tl.disclosure_strong")}</strong>{" "}
        {t("tools.tl.disclosure_body")}
      </div>

      <div className="card">
        <form onSubmit={translate} noValidate>
          <div className="form-row" style={{ maxWidth: 420 }}>
            <Field label={t("tools.tl.from_label")}>
              <Select value={from} onChange={(v) => setFrom(v)}>
                {LANGS.map((l) => (
                  <option key={l.value} value={l.value}>{t(l.labelKey)}</option>
                ))}
              </Select>
            </Field>
            <Field label={t("tools.tl.to_label")}>
              <Select value={to} onChange={(v) => setTo(v)}>
                {LANGS.map((l) => (
                  <option key={l.value} value={l.value}>{t(l.labelKey)}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={t("tools.tl.text_label")}>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={t("tools.tl.text_placeholder")} maxLength={2000} required />
          </Field>
          {from === to && <p className="error-text">{t("tools.tl.same_languages")}</p>}
          <Button type="submit" disabled={busy || from === to || text.trim().length === 0}>
            {busy ? t("tools.tl.translating") : t("tools.tl.translate_to", { language: label(to) })}
          </Button>
        </form>
      </div>

      {result && (
        <div className="grid-3" style={{ marginTop: 16 }}>
          <div className="card">
            <div className="card-title">
              <h3>{t("tools.tl.source")}</h3>
              <Badge tone="gray">{label(from)}</Badge>
            </div>
            <p style={{ whiteSpace: "pre-wrap" }}>{text}</p>
          </div>

          <div className="card" aria-live="polite">
            <div className="card-title">
              <h3>{t("tools.tl.result")}</h3>
              <Badge tone="amber">{t("tools.tl.coverage", { percent: Math.round(result.confidence * 100) })}</Badge>
            </div>
            <p style={{ fontSize: 18, fontWeight: 600, whiteSpace: "pre-wrap" }}>
              {result.translation || <span className="bilingual">{t("tools.tl.nothing_translated")}</span>}
            </p>
            <div style={{ display: "flex", gap: 10, margin: "10px 0", flexWrap: "wrap" }}>
              <Button variant="outline" size="sm" onClick={() => void copyResult()}>
                <Copy size={14} /> {t("tools.tl.copy")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSaveOpen((v) => !v)}>
                <NotebookPen size={14} /> {t("tools.tl.save_phrasebook")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setFlagOpen((v) => !v)}>
                <Flag size={14} /> {t("tools.tl.report_incorrect")}
              </Button>
            </div>

            {saveOpen && (
              <div style={{ display: "grid", gap: 8, margin: "8px 0" }}>
                <input
                  className="input"
                  placeholder={t("tools.tl.save_note_placeholder")}
                  value={saveNote}
                  onChange={(e) => setSaveNote(e.target.value)}
                  maxLength={400}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <Button size="sm" onClick={() => void saveToPhrasebook()}>{t("common.save")}</Button>
                  <Button variant="outline" size="sm" onClick={() => setSaveOpen(false)}>{t("common.cancel")}</Button>
                </div>
              </div>
            )}

            {flagOpen && (
              <div style={{ display: "grid", gap: 8, margin: "8px 0" }}>
                <input
                  className="input"
                  placeholder={t("tools.tl.flag_placeholder")}
                  value={flagReason}
                  onChange={(e) => setFlagReason(e.target.value)}
                  maxLength={400}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <Button size="sm" onClick={() => void flagResult()}>{t("tools.tl.flag_send")}</Button>
                  <Button variant="outline" size="sm" onClick={() => setFlagOpen(false)}>{t("common.cancel")}</Button>
                </div>
                <p className="bilingual">{t("tools.tl.flag_privacy")}</p>
              </div>
            )}

            {result.alternatives.length > 0 && (
              <p className="bilingual" style={{ marginTop: 8 }}>
                {t("tools.tl.try_also")} {result.alternatives.map((a, i) => (
                  <span key={i} className="chip" style={{ marginRight: 6 }}>{a}</span>
                ))}
              </p>
            )}
          </div>

          <div className="card">
            <div className="card-title">
              <h3>{t("tools.tl.how_built")}</h3>
              {result.unmapped.length > 0 && <Badge tone="red">{t("tools.tl.unmapped_badge", { count: result.unmapped.length })}</Badge>}
            </div>
            {result.ruleReferences.length > 0 && (
              <p className="bilingual">{t("tools.tl.applied_rules", { rules: result.ruleReferences.join(", ") })}</p>
            )}
            {result.mapping.length > 0 ? (
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t("tools.tl.column_source")}</th>
                      <th>{label(to)}</th>
                      <th>{t("tools.tl.column_meaning")}</th>
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
              <p className="bilingual">{t("tools.tl.no_mapping")}</p>
            )}
            {result.unmapped.length > 0 && (
              <p className="bilingual" style={{ marginTop: 8 }}>
                {t("tools.tl.unmapped_line", { words: result.unmapped.join(", ") })}
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
      toast(t("tools.pb.removed"));
    } catch (err) {
      toast.error(describeApiError(err, t("tools.pb.remove_failed")));
    }
  };

  const saveNote = async (id: string) => {
    try {
      await api.patch(`/api/ws/${workspaceId}/phrasebook/${id}`, { note: noteDraft });
      setItems((list) => list.map((i) => (i.id === id ? { ...i, note: noteDraft } : i)));
      setEditing(null);
      toast.success(t("tools.pb.note_saved"));
    } catch (err) {
      toast.error(describeApiError(err, t("tools.pb.note_failed")));
    }
  };

  if (!loaded) return <LoadingScreen />;
  if (items.length === 0) {
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <EmptyState
          title={t("tools.pb.empty_title")}
          body={t("tools.pb.empty_body")}
        />
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-title">
        <h3>{t("tools.pb.title")}</h3>
        <span className="bilingual">{t("tools.pb.subtitle")}</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t("tools.pb.column_original")}</th>
              <th>{t("tools.pb.column_translation")}</th>
              <th>{t("tools.pb.column_note")}</th>
              <th>{t("tools.pb.column_actions")}</th>
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
                        placeholder={t("tools.pb.add_note_placeholder")}
                      />
                      <Button size="sm" onClick={() => void saveNote(i.id)}>{t("common.save")}</Button>
                      <Button variant="outline" size="sm" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
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
                        {t("tools.pb.edit_note")}
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => void remove(i.id)}>{t("common.remove")}</Button>
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
