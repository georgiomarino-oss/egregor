import Link from "next/link";
import { policyLinks, siteConfig } from "./site-config";

const appStoreFields = [
  {
    field: "Support URL",
    url: "/support",
    note: "Required in App Store Connect app metadata."
  },
  {
    field: "Privacy Policy URL",
    url: "/privacy",
    note: "Required for Apple app privacy compliance and review."
  },
  {
    field: "Terms of Service URL",
    url: "/terms",
    note: "Needed for legal disclosures and subscription clarity."
  },
  {
    field: "Subscription Terms URL",
    url: siteConfig.appleSubscriptionTermsUrl,
    note: "Use for auto-renewable subscription disclosures."
  }
] as const;

const playFields = [
  {
    field: "Privacy Policy",
    url: "/privacy",
    note: "Required if the app handles user data or sensitive permissions."
  },
  {
    field: "Developer Contact Website",
    url: "/support",
    note: "Shown to users on Google Play listing."
  },
  {
    field: "Account Deletion Entry Point",
    url: "/account-deletion",
    note: "Required when users can create accounts."
  }
] as const;

export default function HomePage() {
  return (
    <>
      <section className="hero-panel stack">
        <span className="hero-kicker">Monetization-Ready Website</span>
        <h1>{siteConfig.appName} Official Website</h1>
        <p>{siteConfig.tagline}</p>
        <p className="hero-lead">
          This site includes the public pages Apple and Google typically expect
          for app submission and monetization setup: support, privacy policy,
          terms, subscription terms, and account deletion instructions.
        </p>
        <div className="cta-row">
          <Link href="/support" className="btn-primary">
            Open Support Page
          </Link>
          <Link href="/privacy" className="btn-ghost">
            Review Privacy Policy
          </Link>
        </div>
      </section>

      <section className="content-panel stack">
        <h2>App Store Connect URL Mapping</h2>
        <ul className="link-list">
          {appStoreFields.map((item) => (
            <li key={item.field}>
              <div className="link-row">
                <span className="chip">{item.field}</span>
                <Link href={item.url} className="chip">
                  {siteConfig.baseUrl}
                  {item.url}
                </Link>
              </div>
              <p>{item.note}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="content-panel stack">
        <h2>Google Play Console URL Mapping</h2>
        <ul className="link-list">
          {playFields.map((item) => (
            <li key={item.field}>
              <div className="link-row">
                <span className="chip">{item.field}</span>
                <Link href={item.url} className="chip">
                  {siteConfig.baseUrl}
                  {item.url}
                </Link>
              </div>
              <p>{item.note}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid-two">
        <article className="content-panel stack">
          <h2>Apple Monetization Checklist</h2>
          <ul className="checklist">
            <li>Accept Paid Apps Agreement in App Store Connect.</li>
            <li>Add banking account and complete tax forms.</li>
            <li>Configure in-app purchases or subscriptions.</li>
            <li>Add support and privacy URLs from this website.</li>
            <li>Ensure paywall includes subscription pricing terms.</li>
          </ul>
        </article>
        <article className="content-panel stack">
          <h2>Google Monetization Checklist</h2>
          <ul className="checklist">
            <li>Create a Google payments profile and merchant account.</li>
            <li>Complete Data safety declarations accurately.</li>
            <li>Add privacy policy URL and developer contact details.</li>
            <li>
              If accounts exist, provide in-app deletion and a web deletion
              method.
            </li>
            <li>Set up subscription products in Play Console.</li>
          </ul>
        </article>
      </section>

      <section className="content-panel stack">
        <h2>Public Legal and Support Pages</h2>
        <p>
          Keep these pages live on your purchased domain before submitting for
          review.
        </p>
        <div className="link-row">
          {policyLinks.map((link) => (
            <Link key={link.href} href={link.href} className="chip">
              {link.label}
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
