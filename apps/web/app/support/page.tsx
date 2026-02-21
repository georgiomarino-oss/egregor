import type { Metadata } from "next";
import Link from "next/link";
import { siteConfig } from "../site-config";

export const metadata: Metadata = {
  title: "Support",
  description:
    "Customer support contact details, billing support links, and platform policy links for Egregor."
};

export default function SupportPage() {
  return (
    <article className="policy-panel">
      <h1>Support</h1>
      <p className="policy-meta">
        This page is intended for App Store and Google Play support URL fields.
      </p>

      <section className="policy-section">
        <h2>Contact Support</h2>
        <ul>
          <li>Email: {siteConfig.supportEmail}</li>
          <li>Phone: {siteConfig.supportPhone}</li>
          <li>Hours: {siteConfig.supportHours}</li>
          <li>Address: {siteConfig.companyAddress}</li>
        </ul>
      </section>

      <section className="policy-section">
        <h2>Help Topics</h2>
        <ul>
          <li>Account access issues and login troubleshooting.</li>
          <li>Subscription status, restore purchase, and billing questions.</li>
          <li>Bug reports, crash reports, and performance issues.</li>
          <li>Data requests, privacy inquiries, and account deletion support.</li>
        </ul>
      </section>

      <section className="policy-section">
        <h2>Subscription and Refund Help</h2>
        <ul>
          <li>
            Apple subscriptions are managed in Apple ID settings; refund
            requests can be submitted through Apple&apos;s report-a-problem
            flow.
          </li>
          <li>
            Google Play subscriptions are managed in Play subscriptions
            settings; refund handling depends on Google Play policy.
          </li>
        </ul>
      </section>

      <section className="policy-section">
        <h2>Compliance Links</h2>
        <div className="link-row">
          <Link href="/privacy" className="chip">
            Privacy Policy
          </Link>
          <Link href="/terms" className="chip">
            Terms of Service
          </Link>
          <Link href="/subscriptions" className="chip">
            Subscription Terms
          </Link>
          <Link href="/account-deletion" className="chip">
            Account Deletion
          </Link>
        </div>
      </section>
    </article>
  );
}
