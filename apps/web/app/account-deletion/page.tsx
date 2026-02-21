import type { Metadata } from "next";
import { siteConfig } from "../site-config";

export const metadata: Metadata = {
  title: "Account Deletion",
  description:
    "Instructions for deleting your Egregor account and associated personal data."
};

export default function AccountDeletionPage() {
  return (
    <article className="policy-panel">
      <h1>Account Deletion</h1>
      <p className="policy-meta">
        We provide both an in-app deletion flow and a web-request method to
        comply with Google Play account deletion requirements.
      </p>

      <section className="policy-section">
        <h2>Delete Directly In The App (Recommended)</h2>
        <ul>
          <li>Sign in to your account in the mobile app.</li>
          <li>Open {siteConfig.accountDeletionPath}.</li>
          <li>Confirm deletion when prompted.</li>
        </ul>
        <p className="inline-note">
          If you do not yet see a Delete account option in the app, use the
          support method below and we will process your request manually.
        </p>
      </section>

      <section className="policy-section">
        <h2>Delete Through Support (Web Method)</h2>
        <ul>
          <li>
            Send an email to {siteConfig.supportEmail} with subject:
            &quot;Account Deletion Request&quot;.
          </li>
          <li>
            Include the email tied to your account and your preferred response
            channel.
          </li>
          <li>
            We may request identity confirmation before processing deletion.
          </li>
        </ul>
      </section>

      <section className="policy-section">
        <h2>What Gets Deleted</h2>
        <ul>
          <li>Profile information and account credentials.</li>
          <li>
            User-submitted content and account-linked activity where legally
            permitted.
          </li>
          <li>Push tokens and personalized preferences.</li>
        </ul>
      </section>

      <section className="policy-section">
        <h2>What May Be Retained</h2>
        <ul>
          <li>
            Transaction and compliance records required by tax, audit, fraud,
            or legal obligations.
          </li>
          <li>
            Minimal logs retained temporarily for security and abuse
            investigations.
          </li>
        </ul>
      </section>

      <section className="policy-section">
        <h2>Processing Timeline</h2>
        <p>
          We target completion within 7 business days after verification, unless
          a shorter period is required by local law.
        </p>
      </section>
    </article>
  );
}
