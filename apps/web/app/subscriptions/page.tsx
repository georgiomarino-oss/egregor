import type { Metadata } from "next";
import Link from "next/link";
import { siteConfig } from "../site-config";

export const metadata: Metadata = {
  title: "Subscription Terms",
  description:
    "Subscription pricing and renewal terms for Egregor premium plans."
};

const samplePlans = [
  {
    title: "Egregor Plus Monthly",
    period: "1 month",
    price: "$9.99 per month"
  },
  {
    title: "Egregor Plus Yearly",
    period: "12 months",
    price: "$59.99 per year"
  }
] as const;

export default function SubscriptionsPage() {
  return (
    <article className="policy-panel">
      <h1>Subscription Terms</h1>
      <p className="policy-meta">
        These terms cover auto-renewable subscriptions offered through Apple
        App Store and Google Play.
      </p>

      <section className="policy-section">
        <h2>Available Plans</h2>
        <ul>
          {samplePlans.map((plan) => (
            <li key={plan.title}>
              {plan.title}: {plan.price} (billing period: {plan.period})
            </li>
          ))}
        </ul>
        <p className="inline-note">
          Update these sample prices to match your live App Store and Google
          Play product configuration.
        </p>
      </section>

      <section className="policy-section">
        <h2>Billing and Renewal</h2>
        <ul>
          <li>
            Payment is charged to your Apple ID or Google Play account at
            purchase confirmation.
          </li>
          <li>
            Subscriptions renew automatically unless canceled at least 24 hours
            before the current period ends.
          </li>
          <li>
            Renewal charges occur within 24 hours before the next billing
            period.
          </li>
          <li>
            You can manage and cancel subscriptions in your Apple or Google
            account settings.
          </li>
        </ul>
      </section>

      <section className="policy-section">
        <h2>Trials and Price Changes</h2>
        <ul>
          <li>
            Free trial availability and length may vary by platform, region, or
            promotional campaign.
          </li>
          <li>
            If prices change, notice and consent flow are handled by the
            platform according to its billing rules.
          </li>
        </ul>
      </section>

      <section className="policy-section">
        <h2>Legal References</h2>
        <div className="link-row">
          <Link href="/terms" className="chip">
            Terms of Service
          </Link>
          <Link href="/privacy" className="chip">
            Privacy Policy
          </Link>
          <Link href="/support" className="chip">
            Support
          </Link>
        </div>
      </section>

      <section className="policy-section">
        <h2>Questions</h2>
        <p>
          Subscription questions can be sent to {siteConfig.supportEmail}. For
          legal questions, contact {siteConfig.legalEmail}.
        </p>
      </section>
    </article>
  );
}
