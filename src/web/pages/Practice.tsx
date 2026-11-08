import { useCallback, useEffect, useState } from "react";
import { Check, Eye, RotateCcw, Volume2, X } from "lucide-react";
import { toast } from "sonner";
import { api, PRACTICE_MODES } from "../api.js";
import { describeApiError } from "../errors.js";
import { Badge, Button, EmptyState, ErrorNote, LoadingScreen, PageHeader, Stat, StatusBadge } from "../ui.js";
import { t } from "../i18n/index.js";

type Workspace = { id: string; name: string; role: string };

interface PracticeItem {
  entryId: string;
  word: string;
  bengaliMeaning: string;
  englishMeaning: string;
  pronunciationGuide: string;
  partOfSpeech: string;
  mode: string;
  status: string;
  options?: string[];
  contextSentence?: string;
}

interface Stats {
  total: number;
  new: number;
  learning: number;
  remembered: number;
  needsRevision: number;
  dueNow: number;
  lastReviewedAt: string | null;
}

const MODE_LABELS: Record<string, string> = {
  mixed: "practice.mode.mixed",
  word_to_bengali: "practice.mode.word_to_bengali",
  word_to_english: "practice.mode.word_to_english",
  bengali_to_word: "practice.mode.bengali_to_word",
  english_to_word: "practice.mode.english_to_word",
  fill_blank: "practice.mode.fill_blank",
  choose_word: "practice.mode.choose_word",
  pronunciation: "practice.mode.pronunciation"
};

const modeLabel = (mode: string): string =>
  MODE_LABELS[mode] ? t(MODE_LABELS[mode]) : mode;

function normalizeAnswer(text: string): string {
  return text.trim().toLowerCase().replace(/[.!?।,]+\s*$/g, "").replace(/\s+/g, " ");
}

/** Best-effort browser TTS; silent no-op where unsupported. */
function speak(text: string): void {
  try {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      toast(t("practice.speech.unsupported"));
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.75;
    utterance.lang = "en-US";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  } catch {
    toast(t("practice.speech.unavailable"));
  }
}

export function Practice({ workspace }: { workspace: Workspace }) {
  const [items, setItems] = useState<PracticeItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<string>("mixed");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-card state.
  const [answer, setAnswer] = useState("");
  const [phase, setPhase] = useState<"answering" | "feedback">("answering");
  const [wasCorrect, setWasCorrect] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [showCorrection, setShowCorrection] = useState(false);
  const [correctionValue, setCorrectionValue] = useState("");

  useEffect(() => {
    document.title = "Practice · Lexora";
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ items: PracticeItem[]; stats: Stats }>(
        `/api/ws/${workspace.id}/practice/queue?limit=10&mode=${encodeURIComponent(mode)}`,
      );
      setItems(res.items);
      setStats(res.stats);
      setIndex(0);
      resetCard();
    } catch (err) {
      setError(describeApiError(err, t("practice.load.error")));
    } finally {
      setLoading(false);
    }
  }, [workspace.id, mode]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetCard(): void {
    setAnswer("");
    setPhase("answering");
    setWasCorrect(false);
    setPicked(null);
    setShowCorrection(false);
    setCorrectionValue("");
  }

  async function recordReview(item: PracticeItem, correct: boolean): Promise<void> {
    try {
      const res = await api.post<{ status: string }>(`/api/ws/${workspace.id}/practice/review`, {
        entryId: item.entryId,
        mode: item.mode,
        correct,
      });
      if (correct) {
        toast.success(res.status === "remembered" ? t("practice.toast.remembered", { word: item.word }) : t("practice.toast.learning", { word: item.word }));
      } else {
        toast(t("practice.toast.needs_revision", { word: item.word }));
      }
    } catch (err) {
      toast.error(describeApiError(err, t("practice.toast.review_failed")));
    }
  }

  /** Typed answers grade themselves against the stored meaning, then the
   * review is recorded with that verdict (spec §13: answering is required). */
  async function submitTyped(item: PracticeItem, expected: string): Promise<void> {
    const correct = answer.trim().length > 0 && normalizeAnswer(answer) === normalizeAnswer(expected);
    setWasCorrect(correct);
    setPhase("feedback");
    await recordReview(item, correct);
  }

  async function pickOption(item: PracticeItem, option: string): Promise<void> {
    if (phase === "feedback") return;
    setPicked(option);
    const correct = normalizeAnswer(option) === normalizeAnswer(item.word);
    setWasCorrect(correct);
    setPhase("feedback");
    await recordReview(item, correct);
  }

  async function selfReport(item: PracticeItem, correct: boolean): Promise<void> {
    setWasCorrect(correct);
    setPhase("feedback");
    await recordReview(item, correct);
  }

  async function advance(): Promise<void> {
    if (index + 1 < items.length) {
      setIndex(index + 1);
      resetCard();
    } else {
      await load();
    }
  }

  /** "My answer was also correct": the stored meaning was the wrong one, so
   * fix the entry itself through the regular dictionary PATCH route. */
  async function saveCorrection(item: PracticeItem): Promise<void> {
    const field = item.mode === "word_to_bengali" ? { bengaliMeaning: correctionValue } : { englishMeaning: correctionValue };
    try {
      await api.patch(`/api/ws/${workspace.id}/dictionary/${item.entryId}`, field);
      toast.success(t("practice.toast.meaning_updated"));
      setShowCorrection(false);
      setCorrectionValue("");
    } catch (err) {
      toast.error(describeApiError(err, t("practice.toast.correction_failed")));
    }
  }

  if (loading) return <LoadingScreen />;

  const current = items[index];
  const mcqReady = Boolean(current?.options && current.options.length >= 2);

  return (
    <div>
      <PageHeader
        title={t("practice.title")}
        subtitle={t("practice.subtitle")}
        actions={
          <label className="bilingual" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {t("practice.mode.label")}
            <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="mixed">{modeLabel("mixed")}</option>
              {PRACTICE_MODES.map((m) => (
                <option key={m} value={m}>
                  {modeLabel(m)}
                </option>
              ))}
            </select>
          </label>
        }
      />

      {stats && (
        <div className="metrics">
          <Stat value={stats.dueNow} label={t("practice.stats.due")} />
          <Stat value={stats.new} label={t("practice.stats.new")} />
          <Stat value={stats.learning} label={t("practice.stats.learning")} />
          <Stat value={stats.remembered} label={t("practice.stats.remembered")} />
          <Stat value={stats.needsRevision} label={t("practice.stats.needs_revision")} />
        </div>
      )}

      <ErrorNote message={error} />
      {error && (
        <Button variant="outline" onClick={() => void load()}>
          <RotateCcw size={15} /> {t("common.retry")}
        </Button>
      )}

      {!error && !current ? (
        <EmptyState
          title={t("practice.empty.title")}
          body={t("practice.empty.body")}
          action={
            <Button variant="outline" onClick={() => void load()}>
              {t("common.refresh")}
            </Button>
          }
        />
      ) : (
        current && (
          <div className="card practice-card">
            <Badge tone="violet">{modeLabel(current.mode)}</Badge>
            <div className="practice-word mono">{current.word}</div>
            <p className="bilingual">
              <StatusBadge status={current.status} /> · {current.partOfSpeech}
            </p>

            {current.mode === "word_to_bengali" && phase === "answering" && (
              <>
                <p className="bilingual">{t("practice.q.word_to_bengali")}</p>
                <TypedAnswer
                  answer={answer}
                  setAnswer={setAnswer}
                  onSubmit={() => void submitTyped(current, current.bengaliMeaning)}
                />
              </>
            )}

            {current.mode === "word_to_english" && phase === "answering" && (
              <>
                <p className="bilingual">{t("practice.q.word_to_english")}</p>
                <TypedAnswer
                  answer={answer}
                  setAnswer={setAnswer}
                  onSubmit={() => void submitTyped(current, current.englishMeaning)}
                />
              </>
            )}

            {(current.mode === "bengali_to_word" || current.mode === "english_to_word") && phase === "answering" && (
              <>
                <p style={{ fontSize: 22, fontWeight: 700 }}>
                  {current.mode === "bengali_to_word" ? current.bengaliMeaning : current.englishMeaning}
                </p>
                <p className="bilingual">{t("practice.q.which_word")}</p>
                {mcqReady ? (
                  <McqOptions options={current.options!} picked={picked} onPick={(o) => void pickOption(current, o)} />
                ) : (
                  <TypedAnswer
                    answer={answer}
                    setAnswer={setAnswer}
                    onSubmit={() => void submitTyped(current, current.word)}
                    placeholder={t("practice.answer.placeholder_word")}
                  />
                )}
              </>
            )}

            {current.mode === "fill_blank" && phase === "answering" && (
              <>
                <p className="bilingual">{t("practice.q.fill_blank")}</p>
                <p className="mono" style={{ fontSize: 18, margin: "8px 0 14px" }}>
                  {current.contextSentence ?? `____ : ${current.englishMeaning}`}
                </p>
                <TypedAnswer
                  answer={answer}
                  setAnswer={setAnswer}
                  onSubmit={() => void submitTyped(current, current.word)}
                  placeholder={t("practice.answer.placeholder_missing")}
                />
              </>
            )}

            {current.mode === "choose_word" && phase === "answering" && (
              <>
                {current.contextSentence && (
                  <p className="mono" style={{ fontSize: 18, margin: "0 0 8px" }}>
                    {current.contextSentence}
                  </p>
                )}
                <p className="bilingual">
                  {current.contextSentence
                    ? t("practice.q.choose_word", { meaning: current.englishMeaning })
                    : t("practice.q.choose_word_plain", { meaning: current.englishMeaning })}
                </p>
                {mcqReady ? (
                  <McqOptions options={current.options!} picked={picked} onPick={(o) => void pickOption(current, o)} />
                ) : (
                  <TypedAnswer
                    answer={answer}
                    setAnswer={setAnswer}
                    onSubmit={() => void submitTyped(current, current.word)}
                    placeholder={t("practice.answer.placeholder_word")}
                  />
                )}
              </>
            )}

            {current.mode === "pronunciation" && phase === "answering" && (
              <>
                <p className="bilingual">
                  {current.pronunciationGuide
                    ? t("practice.q.pronunciation", { guide: current.pronunciationGuide })
                    : t("practice.q.pronunciation_plain")}
                </p>
                <div style={{ display: "flex", gap: 10, justifyContent: "center", margin: "8px 0 14px" }}>
                  <Button variant="outline" onClick={() => speak(current.word)}>
                    <Volume2 size={15} /> {t("practice.q.hear_it")}
                  </Button>
                </div>
                <p className="bilingual" style={{ marginBottom: 10 }}>
                  {t("practice.q.tell_honestly")}
                </p>
                <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                  <Button variant="danger" onClick={() => void selfReport(current, false)}>
                    <X size={15} /> {t("practice.q.not_quite")}
                  </Button>
                  <Button onClick={() => void selfReport(current, true)}>
                    <Check size={15} /> {t("practice.q.said_clearly")}
                  </Button>
                </div>
              </>
            )}

            {phase === "feedback" && (
              <div role="status" aria-live="polite">
                <p style={{ fontSize: 18, fontWeight: 700, color: wasCorrect ? "var(--ok, #1a7f5a)" : "var(--danger, #b3372f)" }}>
                  {wasCorrect ? t("practice.feedback.correct") : t("practice.feedback.wrong")}
                </p>
                <p style={{ fontSize: 20, fontWeight: 700, color: "var(--accent)" }}>
                  {current.word} = {current.englishMeaning} · {current.bengaliMeaning}
                </p>
                {!wasCorrect && answer.trim() && (
                  <p className="bilingual">{t("practice.feedback.your_answer", { answer: answer.trim() })}</p>
                )}
                {!wasCorrect && picked && (
                  <p className="bilingual">{t("practice.feedback.you_picked", { answer: picked })}</p>
                )}
                {current.mode === "pronunciation" && (
                  <div style={{ display: "flex", justifyContent: "center", margin: "8px 0" }}>
                    <Button variant="outline" onClick={() => speak(current.word)}>
                      <Volume2 size={15} /> {t("practice.q.hear_again")}
                    </Button>
                  </div>
                )}

                {!wasCorrect &&
                  (current.mode === "word_to_bengali" || current.mode === "word_to_english") &&
                  !showCorrection && (
                    <p className="bilingual">
                      {t("practice.feedback.correction_intro")}{" "}
                      <Button variant="outline" size="sm" onClick={() => setShowCorrection(true)}>
                        <Eye size={14} /> {t("practice.feedback.correction_button")}
                      </Button>
                    </p>
                  )}
                {!wasCorrect && showCorrection && (
                  <div style={{ maxWidth: 380, margin: "10px auto", display: "grid", gap: 8 }}>
                    <p className="bilingual">
                      {current.mode === "word_to_bengali"
                        ? t("practice.feedback.correction_replace_bn")
                        : t("practice.feedback.correction_replace_en")}
                    </p>
                    <input
                      className="input"
                      value={correctionValue}
                      onChange={(e) => setCorrectionValue(e.target.value)}
                      placeholder={answer.trim() || t("practice.feedback.correction_placeholder")}
                    />
                    <div style={{ display: "flex", gap: 10 }}>
                      <Button onClick={() => void saveCorrection(current)} disabled={!correctionValue.trim()}>
                        {t("practice.feedback.correction_save")}
                      </Button>
                      <Button variant="outline" onClick={() => setShowCorrection(false)}>
                        {t("practice.feedback.correction_keep")}
                      </Button>
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14 }}>
                  <Button onClick={() => void advance()}>
                    {index + 1 < items.length ? t("practice.nav.next_word") : t("practice.nav.finish")}
                  </Button>
                </div>
              </div>
            )}

            <p className="bilingual" style={{ marginTop: 16 }}>
              {t("practice.progress.card", { index: index + 1, total: items.length })}
            </p>
          </div>
        )
      )}
    </div>
  );
}

function TypedAnswer({
  answer,
  setAnswer,
  onSubmit,
  placeholder,
}: {
  answer: string;
  setAnswer: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      style={{ display: "grid", gap: 10, justifyItems: "center", margin: "6px 0 14px" }}
    >
      <input
        className="input"
        style={{ maxWidth: 320 }}
        placeholder={placeholder ?? t("practice.answer.placeholder")}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
      />
      <Button type="submit" disabled={!answer.trim()}>
        <Check size={15} /> {t("practice.answer.check")}
      </Button>
    </form>
  );
}

function McqOptions({
  options,
  picked,
  onPick,
}: {
  options: string[];
  picked: string | null;
  onPick: (option: string) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 8, maxWidth: 340, margin: "10px auto 14px" }}>
      {options.map((option) => (
        <Button
          key={option}
          variant={picked === option ? "primary" : "outline"}
          disabled={Boolean(picked)}
          onClick={() => onPick(option)}
        >
          {option}
        </Button>
      ))}
    </div>
  );
}
