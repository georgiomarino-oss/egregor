import Link from "next/link";
import { policyLinks, siteConfig } from "./site-config";

const pillars = [
  {
    title: "Intention First",
    description:
      "A deliberate pause helps people move from reaction to purpose, then from purpose to action."
  },
  {
    title: "Reflection That Grounds",
    description:
      "Journaling and guided moments are designed to reduce noise and sharpen personal clarity."
  },
  {
    title: "Collective Momentum",
    description:
      "When people align around constructive intent, small choices compound into meaningful change."
  }
] as const;

const journey = [
  {
    step: "Set an intention",
    description:
      "Start with what matters most to you, not what the feed tells you to care about."
  },
  {
    step: "Capture your reflection",
    description:
      "Track thoughts and progress so growth becomes visible, personal, and sustainable."
  },
  {
    step: "Take one real action",
    description:
      "Translate insight into something practical that improves your day or helps someone else."
  },
  {
    step: "Contribute to the whole",
    description:
      "The app reinforces a core belief: individually intentional people create a healthier collective."
  }
] as const;

export default function HomePage() {
  return (
    <>
      <section className="home-hero">
        <div className="hero-grid">
          <div className="hero-copy stack">
            <span className="hero-kicker">Egregor.world</span>
            <h1>When intention is shared, meaningful change accelerates.</h1>
            <p className="hero-lead">{siteConfig.tagline}</p>
            <p>
              Egregor is built for people who believe a better world begins with
              better inner habits: thoughtful attention, consistent reflection,
              and action rooted in values.
            </p>
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
            <h2>
              Collectively, we have the power to shape culture through
              intention.
            </h2>
            <ul className="signal-list">
              <li>Intentional people build intentional communities.</li>
              <li>Intentional communities build resilient futures.</li>
              <li>Egregor exists to make that process practical daily.</li>
            </ul>
          </aside>
        </div>

        <ul className="hero-metrics">
          <li>
            <span>01</span>
            Human-centered design
          </li>
          <li>
            <span>02</span>
            Reflection plus action loop
          </li>
          <li>
            <span>03</span>
            Trust-led platform standards
          </li>
        </ul>
      </section>

      <section id="mission" className="section-block">
        <div className="section-heading stack">
          <p className="section-kicker">Mission</p>
          <h2>Build a calmer, clearer, more constructive digital experience.</h2>
        </div>
        <div className="split-layout">
          <p>
            Most digital products compete for attention. Egregor is built to
            restore attention. We want users to leave with more clarity and more
            agency, not more distraction.
          </p>
          <p>
            Our long-term goal is simple: support people in creating habits
            that improve personal wellbeing and create positive ripple effects
            in homes, teams, and communities.
          </p>
        </div>
        <div className="pillar-grid">
          {pillars.map((pillar) => (
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
          <h2>Why we chose the word &quot;Egregor&quot;</h2>
        </div>
        <div className="meaning-grid">
          <article className="meaning-card stack">
            <h3>Meaning behind the word</h3>
            <p>
              &quot;Egregor&quot; is often used to describe a collective thought
              form: the shared energy and direction that emerges when people
              align around a common intention.
            </p>
          </article>
          <article className="meaning-card stack">
            <h3>Why it fits this app</h3>
            <p>
              We chose the name because it captures our thesis exactly:
              individual mindset matters, but shared intention changes what is
              possible at scale.
            </p>
          </article>
        </div>
      </section>

      <section id="experience" className="section-block">
        <div className="section-heading stack">
          <p className="section-kicker">Experience</p>
          <h2>A simple flow designed for daily momentum.</h2>
        </div>
        <div className="journey-grid">
          {journey.map((item, index) => (
            <article key={item.step} className="journey-step">
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
          <h2>Built to be transparent, compliant, and user-respectful.</h2>
        </div>
        <p>
          Legal and policy pages are part of the experience, not hidden away.
          You can review how data is handled, how subscriptions work, and how
          account deletion is processed.
        </p>
        <div className="trust-grid">
          {policyLinks.map((link) => (
            <article key={link.href} className="trust-card">
              <h3>{link.label}</h3>
              <p>
                Clear, public information aligned with Apple App Store and
                Google Play expectations.
              </p>
              <Link href={link.href} className="trust-link">
                Open page
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="final-cta stack">
        <h2>Let&apos;s make intention practical.</h2>
        <p>
          Questions, partnerships, or support needs? Reach out and the Egregor
          team will respond.
        </p>
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
