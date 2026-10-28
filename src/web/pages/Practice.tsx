import { useCallback, useEffect, useState } from "react";
import { Check, Eye, X } from "lucide-react";
import { api, PRACTICE_MODES } from "../api.js";
import { useToast } from "../state.js";
import { Badge, Button, EmptyState, LoadingScreen, PageHeader, Stat, StatusBadge } from "../ui.js";

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

const MODE_PROMPTS: Record<string, { prompt: string; answer: (i: PracticeItem) => string }> = {
  word_to_bengali: { prompt: "What does this mean in Bengali?", answer: (i) => i.bengaliMeaning },
  word_to_english: { prompt: "What does this mean in English?", answer: (i) => i.englishMeaning },
  bengali_to_word: { prompt: "Which word means this?", answer: (i) => i.word },
  english_to_word: { prompt: "Which word means this?", answer: (i) => i.word },
  fill_blank: { prompt: "Recall this word:", answer: (i) => `${i.word} — ${i.englishMeaning}` },
  choose_word: { prompt: "Recognize this word?", answer: (i) => `${i.word} — ${i.englishMeaning}` },
  pronunciation: { prompt: "Say it out loud:", answer: (i) => i.pronunciationGuide || i.word }
};

export function Practice({ workspace }: { workspace: Workspace }) {
  const [items, setItems] = useState<PracticeItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [answerText, setAnswerText] = useState("");
  const toast = useToast();

  useEffect(() => {
    document.title = "Practice — Lexora";
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ items: PracticeItem[]; stats: Stats }>(`/api/ws/${workspace.id}/practice/queue?limit=10&mode=mixed`);
      setItems(res.items);
      setStats(res.stats);
      setIndex(0);
      setRevealed(false);
      setAnswerText("");
    } finally {
      setLoading(false);
    }
  }, [workspace.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (correct: boolean) => {
    const item = items[index];
    if (!item) return;
    try {
      const res = await api.post<{ status: string }>(`/api/ws/${workspace.id}/practice/review`, {
        entryId: item.entryId,
        mode: item.mode,
        correct
      });
      if (correct) {
        toast(res.status === "remembered" ? `"${item.word}" is remembered!` : `"${item.word}" marked as learning.`, "success");
      } else {
        toast(`"${item.word}" needs revision — it will come back in 10 minutes.`);
      }
      setRevealed(false);
      setAnswerText("");
      if (index + 1 < items.length) {
        setIndex(index + 1);
      } else {
        await load();
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Review failed", "error");
    }
  };

  if (loading) return <LoadingScreen />;

  const current = items[index];

  return (
    <div>
      <PageHeader title="Practice & Revision" subtitle="Spaced repetition on your workspace's approved words. You have to actually answer — viewing a card never marks it mastered." />

      {stats && (
        <div className="metrics">
          <Stat value={stats.dueNow} label="Due now" />
          <Stat value={stats.new} label="New" />
          <Stat value={stats.learning} label="Learning" />
          <Stat value={stats.remembered} label="Remembered" />
        </div>
      )}

      {!current ? (
        <EmptyState
          title="Nothing due right now"
          body="Words come back on a schedule: answer correctly and the interval grows, miss one and it returns in 10 minutes."
          action={<Button variant="outline" onClick={() => void load()}>Refresh</Button>}
        />
      ) : (
        <div className="card practice-card">
          <Badge tone="violet">{PRACTICE_MODES.includes(current.mode as never) ? current.mode.replace(/_/g, " ") : current.mode}</Badge>
          <div className="practice-word mono">{current.word}</div>
          <p className="bilingual">
            {MODE_PROMPTS[current.mode]?.prompt ?? "Recall this word"} · <StatusBadge status={current.status} />
          </p>

          {!revealed ? (
            <>
              <input
                className="input"
                style={{ maxWidth: 320, margin: "0 auto 14px" }}
                placeholder="Type your answer (optional)"
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
              />
              <Button onClick={() => setRevealed(true)}>
                <Eye size={15} /> Reveal answer
              </Button>
            </>
          ) : (
            <>
              <p style={{ fontSize: 20, fontWeight: 700, color: "var(--accent)" }}>
                {MODE_PROMPTS[current.mode]?.answer(current) ?? current.englishMeaning}
              </p>
              <p className="bilingual">
                {current.englishMeaning} · {current.bengaliMeaning} · {current.partOfSpeech}
              </p>
              {answerText.trim() && (
                <p className="bilingual" style={{ marginBottom: 10 }}>
                  You answered: “{answerText.trim()}”
                </p>
              )}
              <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                <Button variant="danger" onClick={() => void review(false)}>
                  <X size={15} /> I was wrong
                </Button>
                <Button onClick={() => void review(true)}>
                  <Check size={15} /> I got it right
                </Button>
              </div>
            </>
          )}
          <p className="bilingual" style={{ marginTop: 16 }}>
            Card {index + 1} of {items.length}
          </p>
        </div>
      )}
    </div>
  );
}
