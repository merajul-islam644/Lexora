import { useCallback, useEffect, useState } from "react";
import { Check, Eye, RotateCcw, Volume2, X } from "lucide-react";
import { toast } from "sonner";
import { api, PRACTICE_MODES } from "../api.js";
import { describeApiError } from "../errors.js";
import { Badge, Button, EmptyState, ErrorNote, LoadingScreen, PageHeader, Stat, StatusBadge } from "../ui.js";

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
  mixed: "Mixed (all modes)",
  word_to_bengali: "Word → Bengali",
  word_to_english: "Word → English",
  bengali_to_word: "Bengali → Word",
  english_to_word: "English → Word",
  fill_blank: "Fill the blank",
  choose_word: "Choose the word",
  pronunciation: "Pronunciation"
};

function normalizeAnswer(text: string): string {
  return text.trim().toLowerCase().replace(/[.!?।,]+\s*$/g, "").replace(/\s+/g, " ");
}

/** Best-effort browser TTS; silent no-op where unsupported. */
function speak(text: string): void {
  try {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      toast("Your browser does not support speech playback.");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.75;
    utterance.lang = "en-US";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  } catch {
    toast("Speech playback is not available right now.");
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
      setError(describeApiError(err, "Could not load the practice queue."));
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
        toast.success(res.status === "remembered" ? `"${item.word}" is remembered!` : `"${item.word}" marked as learning.`);
      } else {
        toast(`"${item.word}" needs revision; it will come back in 10 minutes.`);
      }
    } catch (err) {
      toast.error(describeApiError(err, "Review failed"));
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
      toast.success("Meaning updated in the dictionary.");
      setShowCorrection(false);
      setCorrectionValue("");
    } catch (err) {
      toast.error(describeApiError(err, "Could not update the meaning"));
    }
  }

  if (loading) return <LoadingScreen />;

  const current = items[index];
  const mcqReady = Boolean(current?.options && current.options.length >= 2);

  return (
    <div>
      <PageHeader
        title="Practice & Revision"
        subtitle="Spaced repetition on your workspace's approved words. You have to actually answer; viewing a card never marks it mastered."
        actions={
          <label className="bilingual" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Mode
            <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="mixed">{MODE_LABELS.mixed}</option>
              {PRACTICE_MODES.map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m] ?? m}
                </option>
              ))}
            </select>
          </label>
        }
      />

      {stats && (
        <div className="metrics">
          <Stat value={stats.dueNow} label="Due now" />
          <Stat value={stats.new} label="New" />
          <Stat value={stats.learning} label="Learning" />
          <Stat value={stats.remembered} label="Remembered" />
          <Stat value={stats.needsRevision} label="Needs revision" />
        </div>
      )}

      <ErrorNote message={error} />
      {error && (
        <Button variant="outline" onClick={() => void load()}>
          <RotateCcw size={15} /> Retry
        </Button>
      )}

      {!error && !current ? (
        <EmptyState
          title="Nothing due right now"
          body="Words come back on a schedule: answer correctly and the interval grows, miss one and it returns in 10 minutes."
          action={
            <Button variant="outline" onClick={() => void load()}>
              Refresh
            </Button>
          }
        />
      ) : (
        current && (
          <div className="card practice-card">
            <Badge tone="violet">{MODE_LABELS[current.mode] ?? current.mode}</Badge>
            <div className="practice-word mono">{current.word}</div>
            <p className="bilingual">
              <StatusBadge status={current.status} /> · {current.partOfSpeech}
            </p>

            {current.mode === "word_to_bengali" && phase === "answering" && (
              <>
                <p className="bilingual">What does this word mean in Bengali?</p>
                <TypedAnswer
                  answer={answer}
                  setAnswer={setAnswer}
                  onSubmit={() => void submitTyped(current, current.bengaliMeaning)}
                />
              </>
            )}

            {current.mode === "word_to_english" && phase === "answering" && (
              <>
                <p className="bilingual">What does this word mean in English?</p>
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
                <p className="bilingual">Which word carries this meaning?</p>
                {mcqReady ? (
                  <McqOptions options={current.options!} picked={picked} onPick={(o) => void pickOption(current, o)} />
                ) : (
                  <TypedAnswer
                    answer={answer}
                    setAnswer={setAnswer}
                    onSubmit={() => void submitTyped(current, current.word)}
                    placeholder="Type the word"
                  />
                )}
              </>
            )}

            {current.mode === "fill_blank" && phase === "answering" && (
              <>
                <p className="bilingual">Complete the sentence with this word:</p>
                <p className="mono" style={{ fontSize: 18, margin: "8px 0 14px" }}>
                  {current.contextSentence ?? `____ : ${current.englishMeaning}`}
                </p>
                <TypedAnswer
                  answer={answer}
                  setAnswer={setAnswer}
                  onSubmit={() => void submitTyped(current, current.word)}
                  placeholder="Type the missing word"
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
                  Which word fits{current.contextSentence ? " the blank" : ""}? ({current.englishMeaning})
                </p>
                {mcqReady ? (
                  <McqOptions options={current.options!} picked={picked} onPick={(o) => void pickOption(current, o)} />
                ) : (
                  <TypedAnswer
                    answer={answer}
                    setAnswer={setAnswer}
                    onSubmit={() => void submitTyped(current, current.word)}
                    placeholder="Type the word"
                  />
                )}
              </>
            )}

            {current.mode === "pronunciation" && phase === "answering" && (
              <>
                <p className="bilingual">
                  Say it out loud{current.pronunciationGuide ? ` (syllables: ${current.pronunciationGuide})` : ""}:
                </p>
                <div style={{ display: "flex", gap: 10, justifyContent: "center", margin: "8px 0 14px" }}>
                  <Button variant="outline" onClick={() => speak(current.word)}>
                    <Volume2 size={15} /> Hear it
                  </Button>
                </div>
                <p className="bilingual" style={{ marginBottom: 10 }}>
                  Then tell us honestly how it went:
                </p>
                <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                  <Button variant="danger" onClick={() => void selfReport(current, false)}>
                    <X size={15} /> Not quite yet
                  </Button>
                  <Button onClick={() => void selfReport(current, true)}>
                    <Check size={15} /> I said it clearly
                  </Button>
                </div>
              </>
            )}

            {phase === "feedback" && (
              <div role="status" aria-live="polite">
                <p style={{ fontSize: 18, fontWeight: 700, color: wasCorrect ? "var(--ok, #1a7f5a)" : "var(--danger, #b3372f)" }}>
                  {wasCorrect ? "Correct!" : "Not quite."}
                </p>
                <p style={{ fontSize: 20, fontWeight: 700, color: "var(--accent)" }}>
                  {current.word} = {current.englishMeaning} · {current.bengaliMeaning}
                </p>
                {!wasCorrect && answer.trim() && (
                  <p className="bilingual">You answered: “{answer.trim()}”</p>
                )}
                {!wasCorrect && picked && (
                  <p className="bilingual">You picked: “{picked}”</p>
                )}
                {current.mode === "pronunciation" && (
                  <div style={{ display: "flex", justifyContent: "center", margin: "8px 0" }}>
                    <Button variant="outline" onClick={() => speak(current.word)}>
                      <Volume2 size={15} /> Hear it again
                    </Button>
                  </div>
                )}

                {!wasCorrect &&
                  (current.mode === "word_to_bengali" || current.mode === "word_to_english") &&
                  !showCorrection && (
                    <p className="bilingual">
                      Knew it, but the dictionary's meaning was the wrong one?{" "}
                      <Button variant="outline" size="sm" onClick={() => setShowCorrection(true)}>
                        <Eye size={14} /> My answer was also correct
                      </Button>
                    </p>
                  )}
                {!wasCorrect && showCorrection && (
                  <div style={{ maxWidth: 380, margin: "10px auto", display: "grid", gap: 8 }}>
                    <p className="bilingual">
                      Replace the {current.mode === "word_to_bengali" ? "Bengali" : "English"} meaning with your answer:
                    </p>
                    <input
                      className="input"
                      value={correctionValue}
                      onChange={(e) => setCorrectionValue(e.target.value)}
                      placeholder={answer.trim() || "Your meaning"}
                    />
                    <div style={{ display: "flex", gap: 10 }}>
                      <Button onClick={() => void saveCorrection(current)} disabled={!correctionValue.trim()}>
                        Save meaning
                      </Button>
                      <Button variant="outline" onClick={() => setShowCorrection(false)}>
                        Keep dictionary's version
                      </Button>
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14 }}>
                  <Button onClick={() => void advance()}>
                    {index + 1 < items.length ? "Next word" : "Finish session"}
                  </Button>
                </div>
              </div>
            )}

            <p className="bilingual" style={{ marginTop: 16 }}>
              Card {index + 1} of {items.length}
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
        placeholder={placeholder ?? "Type your answer"}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
      />
      <Button type="submit" disabled={!answer.trim()}>
        <Check size={15} /> Check answer
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
