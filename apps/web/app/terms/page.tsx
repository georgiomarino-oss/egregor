import type { Metadata } from "next";
import Link from "next/link";
import { siteConfig } from "../site-config";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Terms of Service for Egregor, including subscription and billing terms."
};

const updatedOn = "February 21, 2026";

export default function TermsPage() {
  return (
    <article className="policy-panel">
      <h1>Terms of Service</h1>
      <p className="policy-meta">
        Last updated: {updatedOn}. By accessing or using {siteConfig.appName},
        you agree to these terms.
      </p>

      <section className="policy-section">
        <h2>1. Eligibility and Accounts</h2>
        <ul>
          <li>You must provide accurate account information.</li>
          <li>
            You are responsible for maintaining account security and keeping
            credentials confidential.
          </li>
          <li>
            You are responsible for activity performed through your account.
          </li>
        </ul>
      </section>

      <section className="policy-section">
        <h2>2. Acceptable Use</h2>
        <ul>
          <li>
            Do not use the service for unlawful activity, abuse, harassment, or
            unauthorized automation.
          </li>
          <li>
            Do not interfere with service reliability, access controls, or
            security protections.
          </li>
          <li>
            We may suspend or terminate accounts that violate these terms or
            applicable law.
          </li>
        </ul>
      </section>

      <section className="policy-section">
        <h2>3. Digital Purchases and Subscriptions</h2>
        <ul>
          <li>
            Premium features may be sold as one-time purchases or auto-renewing
            subscriptions.
          </li>
          <li>
            Billing is handled by Apple App Store or Google Play, based on your
            device.
          </li>
          <li>
            Subscription pricing, billing period, and trial terms are shown
            before purchase confirmation.
          </li>
          <li>
            Unless canceled before renewal, subscriptions renew automatically.
          </li>
        </ul>
        <p className="inline-note">
          Full subscription disclosures are available on the{" "}
          <Link href="/subscriptions">Subscription Terms</Link> page.
        </p>
      </section>

      <section className="policy-section">
        <h2>4. Cancellations and Refunds</h2>
        <ul>
          <li>
            You can manage or cancel subscriptions from your Apple or Google
            subscription settings.
          </li>
          <li>
            Refund decisions are handled by the platform where payment occurred.
          </li>
          <li>
            We do not directly process card refunds for in-app purchases made
            through app stores.
          </li>
        </ul>
      </section>

      <section className="policy-section">
        <h2>5. Intellectual Property</h2>
        <ul>
          <li>
            The app, trademarks, software, and content are owned by{" "}
            {siteConfig.companyName} or its licensors.
          </li>
          <li>
            You receive a limited, revocable, non-transferable license to use
            the service for personal use.
          </li>
        </ul>
      </section>

      <section className="policy-section">
        <h2>6. Disclaimer and Liability Limits</h2>
        <ul>
          <li>
            The service is provided on an &quot;as is&quot; and &quot;as
            available&quot; basis.
          </li>
          <li>
            To the maximum extent allowed by law, we disclaim implied
            warranties and limit liability for indirect or consequential damages.
          </li>
        </ul>
      </section>

      <section className="policy-section">
        <h2>7. Changes to Terms</h2>
        <p>
          We may update these terms periodically. Material updates will be
          communicated through in-app notice, email, or website update date
          changes.
        </p>
      </section>

      <section className="policy-section">
        <h2>8. Contact</h2>
        <p>
          Questions about these terms can be sent to {siteConfig.legalEmail}.
        </p>
      </section>
    </article>
  );
}
