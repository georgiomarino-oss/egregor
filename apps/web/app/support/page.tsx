import type { Metadata } from "next";
import Link from "next/link";
import { getSiteContent } from "../cms";
import { siteConfig } from "../site-config";
import ContactForm from "./contact-form";

export const metadata: Metadata = {
  title: "Support",
  description:
    "Contact Egregor support for account, billing, technical, legal, and partnership help."
};

export const revalidate = 300;

export default async function SupportPage() {
  const content = await getSiteContent();

  return (
    <article className="policy-panel">
      <h1>{content.support.title}</h1>
      <p className="policy-meta">{content.support.intro}</p>

      <section className="section-block support-form-block">
        <h2>{content.support.formTitle}</h2>
        <p>{content.support.formDescription}</p>
        <ContactForm topics={content.support.topics} />
      </section>

      <section className="policy-section">
        <h2>Direct Contact</h2>
        <ul>
          <li>Email: {siteConfig.supportEmail}</li>
          <li>Phone: {siteConfig.supportPhone}</li>
          <li>Hours: {siteConfig.supportHours}</li>
          <li>Address: {siteConfig.companyAddress}</li>
        </ul>
      </section>

      <section className="policy-section">
        <h2>Subscription and Refund Help</h2>
        <ul>
          <li>
            Apple subscriptions are managed in Apple ID settings; refund
            requests can be submitted through Apple&apos;s report-a-problem flow.
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
