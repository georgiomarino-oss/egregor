export const siteConfig = {
  appName: "Egregor",
  tagline: "Collective intention for positive change.",
  baseUrl: "https://egregor.world",
  supportEmail: "support@egregor.co.uk",
  legalEmail: "legal@egregor.co.uk",
  supportPhone: "+1 (555) 000-0000",
  companyName: "Your Company LLC",
  companyAddress: "123 Main Street, Suite 100, City, ST 00000, United States",
  supportHours: "Monday-Friday, 9:00 AM-5:00 PM PT",
  accountDeletionPath:
    "Profile -> Settings -> Privacy -> Delete account (inside the mobile app)",
  appleSubscriptionTermsUrl: "/subscriptions"
} as const;

export const primaryLinks = [
  { href: "/", label: "Home" },
  { href: "/support", label: "Support" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" }
] as const;

export const policyLinks = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" },
  { href: "/subscriptions", label: "Subscription Terms" },
  { href: "/account-deletion", label: "Account Deletion" }
] as const;
