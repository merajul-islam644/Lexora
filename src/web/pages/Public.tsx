import { Link } from "react-router-dom";
import { BookOpen, Eye, KeyRound, Languages, Lock, Sparkles, Users } from "lucide-react";

/* Header/footer come from the route-level <PublicLayout /> in main.tsx --
   these pages render their sections only. */
export function Landing() {
  return (
    <>
      <section className="hero">
        <span className="eyebrow">A private language for your business</span>
        <h1>Invent a language your team actually owns.</h1>
        <p className="lead">
          Lexora turns your company's own word list (with Bengali and English references kept side by side)
          into a complete constructed language: sounds, words, grammar and example sentences you can review and revise.
        </p>
        <div className="hero-actions">
          <Link to="/signup" className="btn btn-primary btn-lg" style={{ textDecoration: "none" }}>Create your language</Link>
          <Link to="/features" className="btn btn-outline btn-lg" style={{ textDecoration: "none" }}>See how it works</Link>
        </div>
      </section>

      <section className="section">
        <div className="section-title">
          <h2>How it works</h2>
        </div>
        <div className="grid-3">
          <div className="feature-card">
            <div className="icon-box"><BookOpen size={20} /></div>
            <h3>1. Build your dictionary</h3>
            <p>Add words one by one or import a CSV. Every word keeps its বাংলা and English meaning as reference.</p>
          </div>
          <div className="feature-card">
            <div className="icon-box"><Sparkles size={20} /></div>
            <h3>2. Generate the language</h3>
            <p>Lexora designs a sound system, maps every concept to a new word, and writes grammar rules, explained in English and Bengali.</p>
          </div>
          <div className="feature-card">
            <div className="icon-box"><Languages size={20} /></div>
            <h3>3. Use it with your team</h3>
            <p>Draft translations, coin new words consistently, and practice until the language feels natural.</p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="grid-2">
          <div className="feature-card">
            <div className="icon-box"><Eye size={20} /></div>
            <h3>You review everything</h3>
            <p>
              Generated words arrive as drafts, translations are marked draft, and every grammar rule explains itself.
              Nothing is presented as more than it is.
            </p>
          </div>
          <div className="feature-card violet">
            <div className="icon-box"><Users size={20} /></div>
            <h3>Private to your workspace</h3>
            <p>
              Each workspace has its own dictionary and language, isolated on the server. Members see only what their
              role allows: viewer, editor, admin, owner.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

export function Features() {
  return (
    <>
      <section className="hero" style={{ paddingBottom: 24 }}>
        <span className="eyebrow">Features</span>
        <h1>Everything a private language needs</h1>
      </section>
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="grid-3">
          <div className="feature-card">
            <div className="icon-box"><BookOpen size={20} /></div>
            <h3>Dictionary</h3>
            <p>Bilingual references, pronunciation guides, roots and mnemonics. Search, filter, import and export (CSV/JSON).</p>
          </div>
          <div className="feature-card">
            <div className="icon-box"><Sparkles size={20} /></div>
            <h3>Language generation</h3>
            <p>Phonology, vocabulary mapping, grammar rules and example sentences, generated stage by stage, versioned and reversible.</p>
          </div>
          <div className="feature-card violet">
            <div className="icon-box"><Languages size={20} /></div>
            <h3>Translation Lab</h3>
            <p>Rule-based drafts built from your own dictionary, with word-by-word mapping. Honest about what it can't translate.</p>
          </div>
          <div className="feature-card">
            <div className="icon-box"><BookOpen size={20} /></div>
            <h3>Word Builder</h3>
            <p>Coin new words that follow your language's sound rules and derivation patterns, with collision checks.</p>
          </div>
          <div className="feature-card">
            <div className="icon-box"><KeyRound size={20} /></div>
            <h3>Practice & Revision</h3>
            <p>Spaced repetition so the team actually remembers the words. You answer, it schedules. No shortcuts.</p>
          </div>
          <div className="feature-card">
            <div className="icon-box"><Users size={20} /></div>
            <h3>Roles & audit trail</h3>
            <p>Owner, admin, editor, viewer. Every import, export and generation is logged in your workspace's activity log.</p>
          </div>
        </div>
      </section>
    </>
  );
}

export function SecurityPage() {
  return (
    <>
      <section className="hero" style={{ paddingBottom: 24 }}>
        <span className="eyebrow">Security & privacy</span>
        <h1>Private by design, and honest about limits</h1>
        <p className="lead">What Lexora protects, how, and what it explicitly does not do.</p>
      </section>
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="grid-2">
          <div className="feature-card">
            <div className="icon-box"><Lock size={20} /></div>
            <h3>Server-side tenant isolation</h3>
            <p>
              Every read, write, search, export and generation is authorized against your session on the server,
              never in the browser. A workspace you don't belong to answers "not found", so it can't even be probed for existence.
            </p>
          </div>
          <div className="feature-card">
            <div className="icon-box"><KeyRound size={20} /></div>
            <h3>Sessions done properly</h3>
            <p>
              Passwords are hashed with scrypt. Sessions are server-side records behind HttpOnly, SameSite cookies.
              Cross-site state changes are blocked; you can review and revoke every active session.
            </p>
          </div>
          <div className="feature-card">
            <div className="icon-box"><Eye size={20} /></div>
            <h3>Full audit trail</h3>
            <p>Imports, exports, generations, renames and membership changes are recorded in your workspace's activity log, visible to you.</p>
          </div>
          <div className="feature-card" style={{ borderColor: "#F4D5B5" }}>
            <div className="icon-box" style={{ background: "var(--warning-soft)", color: "var(--warning)" }}>
              <Eye size={20} />
            </div>
            <h3>What a constructed language is not</h3>
            <p>
              <strong>A constructed language is not encryption.</strong> Anyone who learns it can read it. Use Lexora to build
              identity, culture and a fun private register, never to protect secrets, credentials or personal data.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
