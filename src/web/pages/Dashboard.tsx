import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { api } from "../api.js";
import { describeApiError } from "../errors.js";
import { useSession } from "../state.js";
import { toast } from "sonner";
import { Button, ErrorNote, Field, Input, LoadingScreen, PageHeader, Select } from "../ui.js";
import { t } from "../i18n/index.js";

/* ------------------------- first-run: create workspace ----------------------- */

export function Welcome() {
  const [name, setName] = useState("");
  const [orgId, setOrgId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { refresh, user, organizations } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "Welcome to Lexora";
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/workspaces", { name, organizationId: orgId || undefined });
      await refresh();
      toast.success(t("dashboard.welcome.toast_created"));
      navigate("/app/dashboard");
    } catch (err) {
      setError(describeApiError(err, t("dashboard.welcome.error")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ maxWidth: 480 }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <h1 style={{ fontSize: 24 }}>{t("dashboard.welcome.title", { name: user?.name || user?.email.split("@")[0] || t("dashboard.greeting.fallback_name") })}</h1>
          <p className="bilingual">{t("dashboard.welcome.body")}</p>
        </div>
        <div className="card">
          <form onSubmit={submit} noValidate>
            <Field label={t("dashboard.welcome.name_label")} hint={t("dashboard.welcome.name_hint")}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("dashboard.welcome.name_placeholder")} minLength={2} maxLength={80} required autoFocus />
            </Field>
            <Field
              label={t("dashboard.welcome.org_label")}
              hint={t("dashboard.welcome.org_hint")}
            >
              <Select value={orgId} onChange={setOrgId} aria-label={t("dashboard.welcome.org_aria")}>
                <option value="">{t("dashboard.welcome.org_none")}</option>
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </Select>
            </Field>
            <ErrorNote message={error} />
            <Button type="submit" disabled={busy || name.trim().length < 2} style={{ width: "100%" }}>
              {busy ? t("dashboard.welcome.creating") : t("dashboard.welcome.create")} <ArrowRight size={15} />
            </Button>
          </form>
        </div>
        <p className="auth-alt">
          {t("dashboard.welcome.alt")}
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
  "workspace.created": "dashboard.action.workspace_created",
  "dictionary.word_added": "dashboard.action.word_added",
  "dictionary.word_updated": "dashboard.action.word_updated",
  "dictionary.word_archived": "dashboard.action.word_archived",
  "dictionary.word_restored": "dashboard.action.word_restored",
  "dictionary.imported": "dashboard.action.dictionary_imported",
  "dictionary.exported": "dashboard.action.dictionary_exported",
  "language.created": "dashboard.action.language_created",
  "language.regenerated": "dashboard.action.language_regenerated",
  "language.restored": "dashboard.action.version_restored",
  "language.renamed": "dashboard.action.language_renamed",
  "member.added": "dashboard.action.member_added"
};

export function Dashboard() {
  const { user } = useSession();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Dashboard · Lexora";
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
        if (alive) setError(describeApiError(err, t("dashboard.subtitle.error")));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <LoadingScreen />;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? t("dashboard.greeting.morning") : hour < 18 ? t("dashboard.greeting.afternoon") : t("dashboard.greeting.evening");
  const name = user?.name || user?.email.split("@")[0] || t("dashboard.greeting.fallback_name");

  return (
    <div>
      <PageHeader
        title={`${greeting}, ${name}`}
        subtitle={data.language ? t("dashboard.subtitle.ready") : t("dashboard.subtitle.empty")}
      />

      {data.language ? (
        <div className="hero-language" style={{ marginBottom: 20 }}>
          <span className="badge">{t("dashboard.hero.private_badge")}</span>
          <div style={{ fontSize: 13, marginTop: 10, color: "#C9D5E2" }}>{t("dashboard.hero.ready_line")}</div>
          <div className="native">
            {data.language.name} <span className="bn" lang="bn" style={{ fontSize: 22, color: "#D8F5EF" }}>{data.language.nativeName}</span>
          </div>
          <p className="desc">{data.language.description}</p>
          <div className="actions">
            <Link to="/app/language" className="btn btn-primary" style={{ textDecoration: "none" }}>{t("dashboard.hero.open_language")}</Link>
            <Link to="/app/dictionary" className="btn btn-outline" style={{ textDecoration: "none", background: "rgba(255,255,255,0.1)", color: "#fff", borderColor: "transparent" }}>
              {t("dashboard.hero.explore_dictionary")}
            </Link>
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2>{t("dashboard.empty.title")}</h2>
          <p className="bilingual">
            {t("dashboard.empty.body")}
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <Link to="/app/dictionary" className="btn btn-primary" style={{ textDecoration: "none" }}>{t("dashboard.empty.open_dictionary")}</Link>
            <Link to="/app/language" className="btn btn-outline" style={{ textDecoration: "none" }}>{t("dashboard.empty.go_language")}</Link>
          </div>
        </div>
      )}

      <div className="metrics">
        <div className="stat">
          <div className="stat-value">{data.metrics.words}</div>
          <div className="stat-label">{t("dashboard.stats.words")}</div>
        </div>
        <div className="stat">
          <div className="stat-value">{data.metrics.grammarRules}</div>
          <div className="stat-label">{t("dashboard.stats.grammar_rules")}</div>
        </div>
        <div className="stat">
          <div className="stat-value">{data.metrics.mappedPercent}%</div>
          <div className="stat-label">{t("dashboard.stats.mapped")}</div>
        </div>
        <div className="stat">
          <div className="stat-value">{formatWhen(data.metrics.updatedAt)}</div>
          <div className="stat-label">{t("dashboard.stats.last_updated")}</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-title">
            <h3>{t("dashboard.recent_words.title")}</h3>
            <Link to="/app/dictionary" className="btn btn-ghost btn-sm">{t("dashboard.recent_words.view_all")}</Link>
          </div>
          {data.preview.length === 0 ? (
            <p className="bilingual">{t("dashboard.recent_words.empty")}</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("dashboard.table.language_word")}</th>
                    <th>{t("dashboard.table.bengali")}</th>
                    <th>{t("dashboard.table.english")}</th>
                    <th>{t("dashboard.table.pronunciation")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.preview.map((p) => (
                    <tr key={p.id}>
                      <td className="mono"><strong>{p.word}</strong></td>
                      <td className="bn" lang="bn">{p.bengaliMeaning || ""}</td>
                      <td>{p.englishMeaning || ""}</td>
                      <td className="bilingual">{p.pronunciationGuide || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">
            <h3>{t("dashboard.recent_activity.title")}</h3>
            <Link to="/app/activity" className="btn btn-ghost btn-sm">{t("dashboard.recent_words.view_all")}</Link>
          </div>
          {data.activity.length === 0 ? (
            <p className="bilingual">{t("dashboard.recent_activity.empty")}</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {data.activity.map((a) => (
                <li key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 14 }}>
                  <span>{ACTION_LABELS[a.action] ? t(ACTION_LABELS[a.action]) : a.action}</span>
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
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return t("dashboard.when.just_now");
  if (mins < 60) return t("dashboard.when.mins_ago", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("dashboard.when.hours_ago", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t("dashboard.when.days_ago", { n: days });
  return new Date(iso).toLocaleDateString();
}
