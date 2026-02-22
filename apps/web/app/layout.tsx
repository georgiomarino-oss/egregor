import type { Metadata } from "next";
import Link from "next/link";
import { Manrope, Playfair_Display } from "next/font/google";
import Script from "next/script";
import type { ReactNode } from "react";
import "./globals.css";
import { BrandLogo } from "./brand-logo";
import { policyLinks, primaryLinks, siteConfig } from "./site-config";

const displayFont = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["600", "700"]
});

const bodyFont = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"]
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.baseUrl),
  manifest: "/manifest.webmanifest",
  title: {
    default: `${siteConfig.appName} | Collective Intention`,
    template: `%s | ${siteConfig.appName}`
  },
  description:
    "Egregor is a collective intention platform helping people turn reflection into meaningful action for themselves and the world.",
  openGraph: {
    type: "website",
    siteName: siteConfig.appName,
    title: `${siteConfig.appName} | Collective Intention`,
    description:
      "A user-facing home for the Egregor vision, story, and trust commitments.",
    images: [
      {
        url: "/brand/egregor-og.png",
        width: 1200,
        height: 630,
        alt: "Egregor"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteConfig.appName} | Collective Intention`,
    description:
      "A user-facing home for the Egregor vision, story, and trust commitments.",
    images: ["/brand/egregor-og.png"]
  },
  icons: {
    icon: [
      { url: "/brand/egregor-favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/egregor-icon-192.png", sizes: "192x192", type: "image/png" }
    ],
    shortcut: "/brand/egregor-favicon-32.png",
    apple: [
      {
        url: "/brand/egregor-apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png"
      }
    ]
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const supportPhoneHref = `tel:${siteConfig.supportPhone.replace(/[^+\d]/g, "")}`;
  const gaMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  return (
    <html lang="en">
      <body className={`${displayFont.variable} ${bodyFont.variable}`}>
        <div className="site-shell">
          <header className="site-header">
            <Link href="/" className="brand-mark">
              <span className="brand-glyph" aria-hidden>
                <BrandLogo size={42} />
              </span>
              <span className="brand-copy">
                <span className="brand-name">{siteConfig.appName}</span>
                <span className="brand-sub">
                  Collective intention in action
                </span>
              </span>
            </Link>
            <nav className="top-nav" aria-label="Primary">
              {primaryLinks.map((link) => (
                <Link key={link.href} href={link.href} className="nav-link">
                  {link.label}
                </Link>
              ))}
            </nav>
            <Link href="/support" className="header-cta">
              Contact
            </Link>
          </header>

          <main className="page-content">{children}</main>

          <footer className="site-footer">
            <section className="footer-brand">
              <div className="footer-brand-top">
                <span className="footer-logo" aria-hidden>
                  <BrandLogo size={34} />
                </span>
                <p className="footer-title">{siteConfig.companyName}</p>
              </div>
              <p className="footer-text">{siteConfig.tagline}</p>
              <p className="footer-text">{siteConfig.companyAddress}</p>
              <p className="footer-text">
                <a
                  href={`mailto:${siteConfig.supportEmail}`}
                  className="footer-inline-link"
                >
                  {siteConfig.supportEmail}
                </a>{" "}
                |{" "}
                <a href={supportPhoneHref} className="footer-inline-link">
                  {siteConfig.supportPhone}
                </a>
              </p>
            </section>

            <nav className="footer-group" aria-label="Explore">
              <p className="footer-heading">Explore</p>
              {primaryLinks.map((link) => (
                <Link key={link.href} href={link.href} className="footer-link">
                  {link.label}
                </Link>
              ))}
            </nav>

            <nav className="footer-group" aria-label="Legal">
              <p className="footer-heading">Legal</p>
              {policyLinks.map((link) => (
                <Link key={link.href} href={link.href} className="footer-link">
                  {link.label}
                </Link>
              ))}
            </nav>
          </footer>
        </div>
        {gaMeasurementId ? (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`}
              strategy="afterInteractive"
            />
            <Script id="ga4-init" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = window.gtag || gtag;
gtag('js', new Date());
gtag('config', '${gaMeasurementId}', { anonymize_ip: true });`}
            </Script>
          </>
        ) : null}
        <Script id="day-period-theme" strategy="beforeInteractive">
          {`(function () {
  function setDayPeriod() {
    var hour = new Date().getHours();
    var period = (hour >= 6 && hour < 18) ? "day" : "evening";
    document.documentElement.setAttribute("data-day-period", period);
  }
  setDayPeriod();
  setInterval(setDayPeriod, 60000);
})();`}
        </Script>
      </body>
    </html>
  );
}
