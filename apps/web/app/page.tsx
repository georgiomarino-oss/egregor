import Link from "next/link";
import { getSiteContent } from "./cms";
import { policyLinks, siteConfig } from "./site-config";

export const revalidate = 300;

export default async function HomePage() {
  const content = await getSiteContent();

  return (
    <>
      <section className="home-hero">
        <div className="hero-grid">
          <div className="hero-copy stack">
            <span className="hero-kicker">{content.hero.kicker}</span>
            <h1>{content.hero.title}</h1>
            <p className="hero-lead">{content.hero.lead}</p>
            <p>{content.hero.body}</p>
            <div className="cta-row">
              <Link href="/#meaning" className="btn-primary">
                Why The Name Matters
              </Link>
              <Link href="/support" className="btn-ghost">
                Get Support
              </Link>
            </div>
          </div>

          <aside className="hero-signal">
            <p className="signal-label">Core Belief</p>
            <h2>{content.hero.beliefTitle}</h2>
            <ul className="signal-list">
              {content.hero.beliefBullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          </aside>
        </div>

        <ul className="hero-metrics">
          {content.hero.metrics.map((metric) => (
            <li key={metric.id}>
              <span>{metric.id}</span>
              {metric.label}
            </li>
          ))}
        </ul>
      </section>

      <section id="mission" className="section-block">
        <div className="section-heading stack">
          <p className="section-kicker">Mission</p>
          <h2>{content.mission.title}</h2>
        </div>
        <div className="split-layout">
          <p>{content.mission.paragraphOne}</p>
          <p>{content.mission.paragraphTwo}</p>
        </div>
        <div className="pillar-grid">
          {content.mission.pillars.map((pillar) => (
            <article key={pillar.title} className="pillar-card">
              <h3>{pillar.title}</h3>
              <p>{pillar.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="meaning" className="section-block">
        <div className="section-heading stack">
          <p className="section-kicker">The Name</p>
          <h2>{content.meaning.title}</h2>
        </div>
        <div className="meaning-grid">
          <article className="meaning-card stack">
            <h3>{content.meaning.meaningTitle}</h3>
            <p>{content.meaning.meaningBody}</p>
          </article>
          <article className="meaning-card stack">
            <h3>{content.meaning.fitTitle}</h3>
            <p>{content.meaning.fitBody}</p>
          </article>
        </div>
      </section>

      <section id="experience" className="section-block">
        <div className="section-heading stack">
          <p className="section-kicker">Experience</p>
          <h2>{content.experience.title}</h2>
        </div>
        <div className="journey-grid">
          {content.experience.steps.map((item, index) => (
            <article key={`${item.step}-${index}`} className="journey-step">
              <p className="step-number">0{index + 1}</p>
              <h3>{item.step}</h3>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading stack">
          <p className="section-kicker">Trust</p>
          <h2>{content.trust.title}</h2>
        </div>
        <p>{content.trust.intro}</p>
        <div className="trust-grid">
          {policyLinks.map((link, index) => (
            <article key={link.href} className="trust-card">
              <h3>{link.label}</h3>
              <p>
                {content.trust.cards[index]?.body ??
                  "Clear, public information aligned with Apple App Store and Google Play expectations."}
              </p>
              <Link href={link.href} className="trust-link">
                Open page
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="final-cta stack">
        <h2>{content.finalCta.title}</h2>
        <p>{content.finalCta.body}</p>
        <div className="cta-row">
          <Link href="/support" className="btn-primary">
            Contact Support
          </Link>
          <a href={`mailto:${siteConfig.supportEmail}`} className="btn-ghost">
            Email Team
          </a>
        </div>
      </section>
    </>
  );
}
