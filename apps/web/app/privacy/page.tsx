import type { Metadata } from "next";
import { siteConfig } from "../site-config";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Privacy Policy for Egregor covering data collection, usage, retention, and user rights."
};

const updatedOn = "February 21, 2026";

export default function PrivacyPolicyPage() {
  return (
    <article className="policy-panel">
      <h1>Privacy Policy</h1>
      <p className="policy-meta">
        Last updated: {updatedOn}. This policy applies to {siteConfig.appName}{" "}
        mobile applications, related services, and this website.
      </p>

      <section className="policy-section">
        <h2>1. Information We Collect</h2>
        <ul>
          <li>
            Account details such as email, display name, and authentication
            identifiers.
          </li>
          <li>
            App usage data including features used, session timestamps, and
            interaction events.
          </li>
          <li>
            Content you submit, such as intentions, profile details, and
            support requests.
          </li>
          <li>
            Device and technical data such as operating system, app version,
            and error logs.
          </li>
          <li>
            Purchase data and subscription status received from app store
            billing providers.
          </li>
        </ul>
      </section>

      <section className="policy-section">
        <h2>2. How We Use Information</h2>
        <ul>
          <li>Provide, secure, and improve app functionality.</li>
          <li>Process subscriptions and restore purchase access.</li>
          <li>Send service notifications and support responses.</li>
          <li>Detect abuse, fraud, and platform policy violations.</li>
          <li>Analyze reliability and performance for product quality.</li>
        </ul>
      </section>

      <section className="policy-section">
        <h2>3. Legal Bases and Disclosures</h2>
        <ul>
          <li>
            We process data to perform our contract with you and to pursue
            legitimate interests in operating the service.
          </li>
          <li>
            We may share data with cloud hosting, analytics, customer support,
            and payment infrastructure providers acting under contract.
          </li>
          <li>
            We may disclose data to comply with applicable law, legal process,
            or enforceable government requests.
          </li>
        </ul>
      </section>

      <section className="policy-section">
        <h2>4. Data Retention</h2>
        <ul>
          <li>
            We keep account data while your account is active and for a limited
            period after closure for compliance, dispute, and security needs.
          </li>
          <li>
            Logs and analytics are retained for operational and security
            monitoring on a rolling schedule.
          </li>
          <li>
            If you request account deletion, we remove or anonymize personal
            data unless retention is required by law.
          </li>
        </ul>
      </section>

      <section className="policy-section">
        <h2>5. Your Rights and Choices</h2>
        <ul>
          <li>Access, update, or correct profile information in the app.</li>
          <li>
            Request account deletion from in-app settings or through our web
            account deletion page.
          </li>
          <li>Opt out of optional notifications in app settings.</li>
          <li>
            Contact us for data access or deletion requests at{" "}
            {siteConfig.legalEmail}.
          </li>
        </ul>
      </section>

      <section className="policy-section">
        <h2>6. Children&apos;s Privacy</h2>
        <p>
          {siteConfig.appName} is not directed to children under 13 (or higher
          age thresholds where required by local law). We do not knowingly
          collect personal information from children.
        </p>
      </section>

      <section className="policy-section">
        <h2>7. International Transfers</h2>
        <p>
          Data may be processed in countries different from your residence. We
          use contractual and organizational safeguards appropriate to
          applicable law.
        </p>
      </section>

      <section className="policy-section">
        <h2>8. Contact</h2>
        <p>
          Privacy questions can be sent to {siteConfig.legalEmail}. Postal
          correspondence can be sent to {siteConfig.companyName},{" "}
          {siteConfig.companyAddress}.
        </p>
      </section>
    </article>
  );
}
