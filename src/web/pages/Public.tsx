import { Link } from "react-router-dom";
import { BookOpen, Eye, KeyRound, Languages, Lock, Sparkles, Users } from "lucide-react";
import { t } from "../i18n/index.js";

/* Header/footer come from the route-level <PublicLayout /> in main.tsx --
   these pages render their sections only. */
export function Landing() {
  return (
    <>
      <section className="hero">
        <span className="eyebrow">{t("landing.hero.eyebrow")}</span>
        <h1>{t("landing.hero.title")}</h1>
        <p className="lead">
          {t("landing.hero.lead")}
        </p>
        <div className="hero-actions">
          <Link to="/signup" className="btn btn-primary btn-lg" style={{ textDecoration: "none" }}>{t("landing.hero.cta_create")}</Link>
          <Link to="/features" className="btn btn-outline btn-lg" style={{ textDecoration: "none" }}>{t("landing.hero.cta_how")}</Link>
        </div>
      </section>

      <section className="section">
        <div className="section-title">
          <h2>{t("landing.how.title")}</h2>
        </div>
        <div className="grid-3">
          <div className="feature-card">
            <div className="icon-box"><BookOpen size={20} /></div>
            <h3>{t("landing.how.step1_title")}</h3>
            <p>{t("landing.how.step1_body")}</p>
          </div>
          <div className="feature-card">
            <div className="icon-box"><Sparkles size={20} /></div>
            <h3>{t("landing.how.step2_title")}</h3>
            <p>{t("landing.how.step2_body")}</p>
          </div>
          <div className="feature-card">
            <div className="icon-box"><Languages size={20} /></div>
            <h3>{t("landing.how.step3_title")}</h3>
            <p>{t("landing.how.step3_body")}</p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="grid-2">
          <div className="feature-card">
            <div className="icon-box"><Eye size={20} /></div>
            <h3>{t("landing.review.title")}</h3>
            <p>
              {t("landing.review.body")}
            </p>
          </div>
          <div className="feature-card violet">
            <div className="icon-box"><Users size={20} /></div>
            <h3>{t("landing.private.title")}</h3>
            <p>
              {t("landing.private.body")}
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
        <span className="eyebrow">{t("landing.features.eyebrow")}</span>
        <h1>{t("landing.features.title")}</h1>
      </section>
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="grid-3">
          <div className="feature-card">
            <div className="icon-box"><BookOpen size={20} /></div>
            <h3>{t("landing.features.dictionary_title")}</h3>
            <p>{t("landing.features.dictionary_body")}</p>
          </div>
          <div className="feature-card">
            <div className="icon-box"><Sparkles size={20} /></div>
            <h3>{t("landing.features.generation_title")}</h3>
            <p>{t("landing.features.generation_body")}</p>
          </div>
          <div className="feature-card violet">
            <div className="icon-box"><Languages size={20} /></div>
            <h3>{t("landing.features.translation_title")}</h3>
            <p>{t("landing.features.translation_body")}</p>
          </div>
          <div className="feature-card">
            <div className="icon-box"><BookOpen size={20} /></div>
            <h3>{t("landing.features.wordbuilder_title")}</h3>
            <p>{t("landing.features.wordbuilder_body")}</p>
          </div>
          <div className="feature-card">
            <div className="icon-box"><KeyRound size={20} /></div>
            <h3>{t("landing.features.practice_title")}</h3>
            <p>{t("landing.features.practice_body")}</p>
          </div>
          <div className="feature-card">
            <div className="icon-box"><Users size={20} /></div>
            <h3>{t("landing.features.roles_title")}</h3>
            <p>{t("landing.features.roles_body")}</p>
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
        <span className="eyebrow">{t("landing.security.eyebrow")}</span>
        <h1>{t("landing.security.title")}</h1>
        <p className="lead">{t("landing.security.lead")}</p>
      </section>
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="grid-2">
          <div className="feature-card">
            <div className="icon-box"><Lock size={20} /></div>
            <h3>{t("landing.security.isolation_title")}</h3>
            <p>
              {t("landing.security.isolation_body")}
            </p>
          </div>
          <div className="feature-card">
            <div className="icon-box"><KeyRound size={20} /></div>
            <h3>{t("landing.security.sso_title")}</h3>
            <p>
              {t("landing.security.sso_body")}
            </p>
          </div>
          <div className="feature-card">
            <div className="icon-box"><Eye size={20} /></div>
            <h3>{t("landing.security.audit_title")}</h3>
            <p>{t("landing.security.audit_body")}</p>
          </div>
          <div className="feature-card" style={{ borderColor: "#F4D5B5" }}>
            <div className="icon-box" style={{ background: "var(--warning-soft)", color: "var(--warning)" }}>
              <Eye size={20} />
            </div>
            <h3>{t("landing.security.not_title")}</h3>
            <p>
              <strong>{t("landing.security.not_strong")}</strong> {t("landing.security.not_body")}
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
