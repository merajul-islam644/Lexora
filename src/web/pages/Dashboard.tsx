import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { api } from "../api.js";
import { useSession, useToast } from "../state.js";
import { Button, ErrorNote, Field, Input, LoadingScreen, PageHeader } from "../ui.js";

/* ------------------------- first-run: create workspace ----------------------- */

export function Welcome() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { refresh, user } = useSession();
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    document.title = "Welcome to Lexora";
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/workspaces", { name });
      await refresh();
      toast("Workspace created. Welcome!", "success");
      navigate("/app/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the workspace");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ maxWidth: 480 }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <h1 style={{ fontSize: 24 }}>Welcome, {user?.name || user?.email.split("@")[0] || "there"}!</h1>
          <p className="bilingual">Create your first workspace — a private home for your dictionary and language.</p>
        </div>
        <div className="card">
          <form onSubmit={submit} noValidate>
            <Field label="Workspace name" hint="Usually your company or team name.">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Northstar Trading" minLength={2} maxLength={80} required autoFocus />
            </Field>
            <ErrorNote message={error} />
            <Button type="submit" disabled={busy || name.trim().length < 2} style={{ width: "100%" }}>
              {busy ? "Creating…" : "Create workspace"} <ArrowRight size={15} />
            </Button>
          </form>
        </div>
        <p className="auth-alt">
          You can create more workspaces later — each one gets its own private language.
        </p>
      </div>
    </div>
  );
}

/* --------------------------------- dashboard --------------------------------- */

interface DashboardData {
  workspace: { id: string; name: string; isDemo: boolean; role: string };
  language: { id: string; name: string; nativeName: string; description: string; version: number; status: string } | null;
  metrics: { words: number; grammarRules: number; mappedPercent: number; updatedAt: string | null };
  preview: Array<{ id: string; word: string; bengaliMeaning: string; englishMeaning: string; partOfSpeech: string; pronunciationGuide: string; source: string }>;
  activity: Array<{ id: string; action: string; createdAt: string; metadata: Record<string, unknown> }>;
}

const ACTION_LABELS: Record<string, string> = {
  "workspace.created": "Workspace created",
  "dictionary.word_added": "Word added",
  "dictionary.word_updated": "Word updated",
  "dictionary.word_archived": "Word archived",
  "dictionary.word_restored": "Word restored",
  "dictionary.imported": "Dictionary imported",
  "dictionary.exported": "Dictionary exported",
  "language.created": "Language generated",
  "language.regenerated": "Language regenerated",
  "language.restored": "Version restored",
  "language.renamed": "Language renamed",
  "member.added": "Member added"
};

export function Dashboard() {
  const { user } = useSession();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Dashboard — Lexora";
  }, []);

  useEffect(() => {
    let alive = true;
    setData(null);
    void (async () => {
      try {
        const ws = await api.get<{ workspaces: Array<{ id: string }> }>("/api/workspaces");
        const id = localStorage.getItem("lexora.activeWorkspace") ?? ws.workspaces[0]?.id;
        if (!id) return;
        const dash = await api.get<DashboardData>(`/api/ws/${id}/dashboard`);
        if (alive) setData(dash);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Could not load dashboard");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <LoadingScreen />;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const name = user?.name || user?.email.split("@")[0] || "there";

  return (
    <div>
      <PageHeader
        title={`${greeting} — ${name}`}
        subtitle={data.language ? "Your private business language is ready to grow." : "Start by building your dictionary, then generate your language."}
      />

      {data.language ? (
        <div className="hero-language" style={{ marginBottom: 20 }}>
          <span className="badge">Private to your workspace</span>
          <div style={{ fontSize: 13, marginTop: 10, color: "#C9D5E2" }}>Your language is ready</div>
          <div className="native">
            {data.language.name} <span className="bn" style={{ fontSize: 22, color: "#D8F5EF" }}>{data.language.nativeName}</span>
          </div>
          <p className="desc">{data.language.description}</p>
          <div className="actions">
            <Link to="/app/language" className="btn btn-primary" style={{ textDecoration: "none" }}>Open My Language</Link>
            <Link to="/app/dictionary" className="btn btn-outline" style={{ textDecoration: "none", background: "rgba(255,255,255,0.1)", color: "#fff", borderColor: "transparent" }}>
              Explore Dictionary
            </Link>
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2>No language yet</h2>
          <p className="bilingual">
            Add at least one word to your dictionary, then generate your language from it. Every generated word stays
            reviewable — and regenerating keeps your previous versions.
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <Link to="/app/dictionary" className="btn btn-primary" style={{ textDecoration: "none" }}>Open Dictionary</Link>
            <Link to="/app/language" className="btn btn-outline" style={{ textDecoration: "none" }}>Go to My Language</Link>
          </div>
        </div>
      )}

      <div className="metrics">
        <div className="stat">
          <div className="stat-value">{data.metrics.words}</div>
          <div className="stat-label">Words</div>
        </div>
        <div className="stat">
          <div className="stat-value">{data.metrics.grammarRules}</div>
          <div className="stat-label">Grammar rules</div>
        </div>
        <div className="stat">
          <div className="stat-value">{data.metrics.mappedPercent}%</div>
          <div className="stat-label">Dictionary mapped</div>
        </div>
        <div className="stat">
          <div className="stat-value">{formatWhen(data.metrics.updatedAt)}</div>
          <div className="stat-label">Last updated</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-title">
            <h3>Recent words</h3>
            <Link to="/app/dictionary" className="btn btn-ghost btn-sm">View all</Link>
          </div>
          {data.preview.length === 0 ? (
            <p className="bilingual">No words yet — your dictionary is waiting for its first entry.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Language word</th>
                    <th>বাংলা</th>
                    <th>English</th>
                    <th>Pronunciation</th>
                  </tr>
                </thead>
                <tbody>
                  {data.preview.map((p) => (
                    <tr key={p.id}>
                      <td className="mono"><strong>{p.word}</strong></td>
                      <td className="bn">{p.bengaliMeaning || "—"}</td>
                      <td>{p.englishMeaning || "—"}</td>
                      <td className="bilingual">{p.pronunciationGuide || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">
            <h3>Recent activity</h3>
            <Link to="/app/activity" className="btn btn-ghost btn-sm">View all</Link>
          </div>
          {data.activity.length === 0 ? (
            <p className="bilingual">Nothing here yet.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {data.activity.map((a) => (
                <li key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 14 }}>
                  <span>{ACTION_LABELS[a.action] ?? a.action}</span>
                  <span className="bilingual" style={{ whiteSpace: "nowrap" }}>{formatWhen(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
