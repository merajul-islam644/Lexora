import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, PARTS_OF_SPEECH, type GrammarData } from "../api.js";
import { describeApiError } from "../errors.js";
import { Badge, Button, EmptyState, ErrorNote, Field, LoadingScreen, PageHeader, Select, Textarea } from "../ui.js";

type Workspace = { id: string; name: string; role: string };

type Rule = GrammarData["rules"][number];
type Sentence = GrammarData["exampleSentences"][number];

/** Best-effort association: sentences whose grammar notes mention a
 * significant word from the rule's name or pattern (spec §11 "affected
 * sentences"). Not a parse -- an honest pointer, labeled as such. */
function relatedSentences(rule: Rule, sentences: Sentence[]): Sentence[] {
  const tokens = `${rule.name} ${rule.pattern}`
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length >= 4);
  if (tokens.length === 0) return [];
  return sentences.filter((s) => {
    const hay = s.grammarNotes.toLowerCase();
    return tokens.some((t) => hay.includes(t));
  });
}

interface RuleFormState {
  id?: string;
  name: string;
  category: string;
  explanationEnglish: string;
  explanationBengali: string;
  pattern: string;
  validExamples: string; // one example per line
}

const EMPTY_FORM: RuleFormState = {
  name: "",
  category: "",
  explanationEnglish: "",
  explanationBengali: "",
  pattern: "",
  validExamples: "",
};

const AFFIX_LABELS: Array<{ key: keyof NonNullable<GrammarData["affixes"]>; en: string; bn: string }> = [
  { key: "plural", en: "Plural", bn: "বহুবচন" },
  { key: "past", en: "Past tense", bn: "অতীত কাল" },
  { key: "future", en: "Future tense", bn: "ভবিষ্যৎ কাল" },
  { key: "negation", en: "Negation", bn: "না-বোধক" },
  { key: "question", en: "Question", bn: "প্রশ্নবোধক" },
  { key: "genitive", en: "Possessive", bn: "সম্পর্ক/অধিকরণ" },
  { key: "formal", en: "Formal register", bn: "সম্মানসূচক" },
];

export function GrammarWorkspace({ workspace }: { workspace: Workspace }) {
  const [grammar, setGrammar] = useState<GrammarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<RuleFormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const canEdit = workspace.role === "editor" || workspace.role === "admin" || workspace.role === "owner";
  const canDelete = workspace.role === "admin" || workspace.role === "owner";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setGrammar(await api.get<GrammarData>(`/api/ws/${workspace.id}/language/grammar`));
    } catch (err) {
      setError(describeApiError(err, "Could not load the grammar"));
    } finally {
      setLoading(false);
    }
  }, [workspace.id]);

  useEffect(() => {
    document.title = "Grammar Workspace · Lexora";
    void load();
  }, [load]);

  const submitRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setFormError(null);
    const payload = {
      name: form.name,
      category: form.category,
      explanationEnglish: form.explanationEnglish,
      explanationBengali: form.explanationBengali,
      pattern: form.pattern,
      validExamples: form.validExamples
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 6),
    };
    try {
      if (form.id) {
        const res = (await api.patch(`/api/ws/${workspace.id}/language/rules/${form.id}`, payload)) as { message: string };
        toast.success(res.message);
      } else {
        const res = (await api.post(`/api/ws/${workspace.id}/language/rules`, payload)) as { message: string };
        toast.success(res.message);
      }
      setForm(null);
      await load();
    } catch (err) {
      setFormError(describeApiError(err, "Could not save the rule"));
    } finally {
      setBusy(false);
    }
  };

  const deleteRule = async (rule: Rule) => {
    setBusy(true);
    try {
      const res = (await api.del(`/api/ws/${workspace.id}/language/rules/${rule.id}`)) as { message: string };
      toast.success(res.message);
      setConfirmDeleteId(null);
      await load();
    } catch (err) {
      toast.error(describeApiError(err, "Could not remove the rule"));
      setConfirmDeleteId(null);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingScreen />;

  if (error || !grammar) {
    return (
      <div className="grammar-page">
        <PageHeader title="Grammar Workspace" subtitle="Your language's full grammar: sounds, word order, affixes, rules and examples." />
        <ErrorNote message={error} />
        <div className="card">
          <EmptyState
            icon={<Sparkles size={28} />}
            title="No grammar yet"
            body="Generate your language first — its grammar rules, sound system and example sentences live here once it exists."
            action={
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                <Link to="/app/language" className="btn btn-primary" style={{ textDecoration: "none" }}>
                  Go to My Language
                </Link>
                {error && (
                  <Button variant="outline" onClick={() => void load()}>
                    Retry
                  </Button>
                )}
              </div>
            }
          />
        </div>
      </div>
    );
  }

  // Business terminology grouped by part of speech.
  const byPos = new Map<string, GrammarData["vocabulary"]>();
  for (const v of grammar.vocabulary) {
    const list = byPos.get(v.partOfSpeech) ?? [];
    list.push(v);
    byPos.set(v.partOfSpeech, list);
  }

  return (
    <div className="grammar-page">
      <PageHeader
        title="Grammar Workspace"
        subtitle={`${grammar.language.name} (${grammar.language.nativeName}) — the full rulebook: sounds, word order, affixes, rules and examples. Rule edits create a new version, nothing is silently overwritten.`}
      />

      <div className="grid-2">
        <div className="card">
          <div className="card-title">
            <h2>Writing system</h2>
            <Badge tone="gray">{grammar.writingSystem.type}</Badge>
          </div>
          <p className="bilingual">{grammar.writingSystem.description}</p>
          <div className="chips" style={{ margin: "8px 0" }}>
            {grammar.writingSystem.alphabet.map((a) => (
              <span key={a} className="chip mono">{a}</span>
            ))}
          </div>
          <p className="bilingual">Numerals: {grammar.writingSystem.numerals}</p>
          <p className="bilingual">{grammar.writingSystem.capitalization}</p>
        </div>

        <div className="card">
          <div className="card-title">
            <h2>Sound inventory</h2>
            <Badge tone="violet">{grammar.language.wordOrder} word order</Badge>
          </div>
          <p className="bilingual" style={{ marginBottom: 4 }}>Consonants: {grammar.phonology.consonants.join(", ")}</p>
          <p className="bilingual" style={{ marginBottom: 4 }}>Vowels: {grammar.phonology.vowels.join(", ")}</p>
          <p className="bilingual" style={{ marginBottom: 4 }}>
            Syllable rules: <strong>{grammar.phonology.syllableStructures.join(", ")}</strong>
          </p>
          <p className="bilingual" style={{ marginBottom: 6 }}>{grammar.phonology.stressRule}</p>
          {grammar.phonology.forbiddenClusters.length > 0 && (
            <p className="bilingual">
              Forbidden sound clusters:{" "}
              <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", verticalAlign: "middle" }}>
                {grammar.phonology.forbiddenClusters.map((c) => (
                  <span key={c} className="chip mono" style={{ fontSize: 12 }}>{c}</span>
                ))}
              </span>
            </p>
          )}
          {grammar.phonology.pronunciationConventions.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Pronunciation</th>
                  </tr>
                </thead>
                <tbody>
                  {grammar.phonology.pronunciationConventions.map((p) => (
                    <tr key={p.symbol}>
                      <td><code>{p.symbol}</code></td>
                      <td className="bilingual">{p.guide}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {grammar.affixes && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">
            <h2>Inflectional affixes</h2>
            <span className="bilingual">The seven endings every sentence leans on.</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Function</th>
                  <th>Affix</th>
                  <th>Example</th>
                </tr>
              </thead>
              <tbody>
                {AFFIX_LABELS.map(({ key, en, bn }) => (
                  <tr key={key}>
                    <td>{en} <span className="bn bilingual" lang="bn" style={{ color: "var(--text-muted)" }}>{bn}</span></td>
                    <td>{grammar.affixes?.[key] ? <code>-{grammar.affixes[key]}</code> : <span className="bilingual" style={{ color: "var(--text-muted)" }}>—</span>}</td>
                    <td className="mono bilingual">
                      {grammar.affixes?.[key]
                        ? `${grammar.language.name.toLowerCase().slice(0, 3)}${grammar.affixes[key]}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(grammar.wordFormation.prefixes.length > 0 || grammar.wordFormation.suffixes.length > 0) && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">
            <h2>Derivations (word formation)</h2>
            <span className="bilingual">How new concepts grow from existing roots.</span>
          </div>
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

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">
          <h2>Rules ({grammar.rules.length})</h2>
          {canEdit && form === null && (
            <Button onClick={() => { setForm({ ...EMPTY_FORM }); setFormError(null); }}>
              <Plus size={15} /> Add a rule
            </Button>
          )}
        </div>

        {form !== null && (
          <form className="card" style={{ margin: "10px 0", background: "var(--gray-soft, rgba(127,127,127,0.06))" }} onSubmit={submitRule} noValidate>
            <div className="form-row">
              <Field label="Rule name">
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} required />
              </Field>
              <Field label="Category">
                <input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} maxLength={60} list="grammar-categories" required />
              </Field>
              <datalist id="grammar-categories">
                {[...new Set(grammar.rules.map((r) => r.category)), ...PARTS_OF_SPEECH].map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <Field label="Explanation (English)">
              <Textarea value={form.explanationEnglish} onChange={(e) => setForm({ ...form, explanationEnglish: e.target.value })} rows={3} maxLength={1200} required />
            </Field>
            <Field label="Explanation (বাংলা)">
              <Textarea value={form.explanationBengali} onChange={(e) => setForm({ ...form, explanationBengali: e.target.value })} rows={2} maxLength={1200} />
            </Field>
            <div className="form-row">
              <Field label="Pattern" hint='e.g. "Subject + Object + Verb"'>
                <input className="input mono" value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value })} maxLength={300} />
              </Field>
              <Field label="Valid examples" hint="One per line, up to 6.">
                <Textarea value={form.validExamples} onChange={(e) => setForm({ ...form, validExamples: e.target.value })} rows={3} maxLength={1800} />
              </Field>
            </div>
            <ErrorNote message={formError} />
            <div style={{ display: "flex", gap: 10 }}>
              <Button type="submit" disabled={busy || form.name.trim().length < 2 || form.category.trim().length < 2 || form.explanationEnglish.trim().length < 3}>
                {form.id ? "Save rule (new version)" : "Add rule (new version)"}
              </Button>
              <Button variant="outline" onClick={() => setForm(null)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {grammar.rules.map((rule) => {
          const affected = relatedSentences(rule, grammar.exampleSentences);
          return (
            <div className="accordion" key={rule.id}>
              <button className="accordion-head" onClick={() => setOpenId(openId === rule.id ? null : rule.id)} aria-expanded={openId === rule.id}>
                <span>
                  {rule.name} <span className="bilingual">· {rule.category}</span>
                </span>
                <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  <Badge tone="gray">v{rule.introducedInVersion}</Badge>
                  <span className="bilingual">{openId === rule.id ? "−" : "+"}</span>
                </span>
              </button>
              {openId === rule.id && (
                <div className="accordion-body">
                  <p style={{ marginTop: 10 }}>{rule.explanationEnglish}</p>
                  {rule.explanationBengali && <p className="bn bilingual" lang="bn">{rule.explanationBengali}</p>}
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
                  {affected.length > 0 && (
                    <p className="bilingual" style={{ fontSize: 13, color: "var(--text-muted)" }}>
                      Seen in {affected.length} example sentence{affected.length === 1 ? "" : "s"} below.
                    </p>
                  )}
                  {(canEdit || canDelete) && (
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      {canEdit && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setForm({
                              id: rule.id,
                              name: rule.name,
                              category: rule.category,
                              explanationEnglish: rule.explanationEnglish,
                              explanationBengali: rule.explanationBengali,
                              pattern: rule.pattern,
                              validExamples: rule.validExamples.join("\n"),
                            });
                            setFormError(null);
                            setOpenId(rule.id);
                          }}
                        >
                          <Pencil size={14} /> Edit
                        </Button>
                      )}
                      {canDelete &&
                        (confirmDeleteId === rule.id ? (
                          <>
                            <Button variant="danger" size="sm" onClick={() => void deleteRule(rule)} disabled={busy}>
                              Confirm remove
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => setConfirmDeleteId(null)}>
                              Keep it
                            </Button>
                          </>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(rule.id)}>
                            <Trash2 size={14} /> Remove
                          </Button>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {grammar.exampleSentences.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">
            <h2>Example sentences ({grammar.exampleSentences.length})</h2>
          </div>
          {grammar.exampleSentences.map((s) => (
            <div key={s.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border, rgba(127,127,127,0.2))" }}>
              <p style={{ margin: 0 }}>
                <strong>{s.constructed}</strong>{" "}
                {s.reviewStatus === "draft" && <Badge tone="amber">Draft</Badge>}
              </p>
              <p className="bn bilingual" lang="bn" style={{ margin: "2px 0 0" }}>{s.bengali}</p>
              <p className="bilingual" style={{ margin: "2px 0 0", color: "var(--text-muted)", fontSize: 13 }}>{s.english}</p>
              {s.gloss.length > 0 && (
                <div className="chips" style={{ marginTop: 6 }}>
                  {s.gloss.map((g, i) => (
                    <span key={i} className="chip" style={{ fontSize: 12 }}>
                      <code>{g.token}</code> = {g.meaning}
                    </span>
                  ))}
                </div>
              )}
              {s.grammarNotes && (
                <p className="bilingual" style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>{s.grammarNotes}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {grammar.vocabulary.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">
            <h2>Business terminology</h2>
            <span className="bilingual">{grammar.vocabulary.length} words, grouped by part of speech. The full list lives in the <Link to="/app/dictionary">Dictionary</Link>.</span>
          </div>
          {[...byPos.entries()].map(([pos, list]) => (
            <div key={pos} style={{ marginBottom: 10 }}>
              <h3 style={{ marginBottom: 4 }}>{pos} ({list.length})</h3>
              <div className="chips">
                {list.slice(0, 30).map((v) => (
                  <span key={v.word} className="chip">
                    <strong className="mono">{v.word}</strong> — {v.englishMeaning || v.bengaliMeaning}
                    {v.source === "user" && <span className="bilingual"> (yours)</span>}
                  </span>
                ))}
                {list.length > 30 && (
                  <span className="chip bilingual">+{list.length - 30} more in the Dictionary</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="bilingual" style={{ marginTop: 16, color: "var(--text-muted)", fontSize: 13 }}>
        {grammar.language.name} is at version {grammar.language.version}. Every rule edit above records a new version —
        compare or restore any time from <Link to="/app/language">My Language</Link>.
      </p>
    </div>
  );
}
