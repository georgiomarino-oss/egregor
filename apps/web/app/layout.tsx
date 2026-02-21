import type { Metadata } from "next";
import Link from "next/link";
import { Manrope, Playfair_Display } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";
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
  title: {
    default: `${siteConfig.appName} | Official Site`,
    template: `%s | ${siteConfig.appName}`
  },
  description:
    "Official website for Egregor with support, privacy policy, terms, and monetization compliance pages for Apple and Google app stores.",
  openGraph: {
    type: "website",
    siteName: siteConfig.appName,
    title: `${siteConfig.appName} | Official Site`,
    description:
      "Support and legal pages required for App Store and Google Play monetization setup."
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteConfig.appName} | Official Site`,
    description:
      "Support and legal pages required for App Store and Google Play monetization setup."
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${displayFont.variable} ${bodyFont.variable}`}>
        <div className="site-shell">
          <header className="site-header">
            <Link href="/" className="brand-mark">
              <span className="brand-pill">{siteConfig.appName}</span>
            </Link>
            <nav className="top-nav" aria-label="Primary">
              {primaryLinks.map((link) => (
                <Link key={link.href} href={link.href} className="nav-link">
                  {link.label}
                </Link>
              ))}
            </nav>
          </header>

          <main className="page-content">{children}</main>

          <footer className="site-footer">
            <div className="footer-copy">
              <p>{siteConfig.companyName}</p>
              <p>{siteConfig.companyAddress}</p>
            </div>
            <nav className="footer-nav" aria-label="Legal">
              {policyLinks.map((link) => (
                <Link key={link.href} href={link.href} className="footer-link">
                  {link.label}
                </Link>
              ))}
            </nav>
          </footer>
        </div>
      </body>
    </html>
  );
}
