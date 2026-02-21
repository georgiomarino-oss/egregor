export const siteConfig = {
  appName: "Egregor",
  tagline:
    "A shared space where intention becomes action and action becomes meaningful change.",
  baseUrl: "https://egregor.world",
  supportEmail: "support@egregor.co.uk",
  legalEmail: "legal@egregor.co.uk",
  supportPhone: "+44 7470 412207",
  companyName: "EGREGOR.WORLD LTD",
  companyAddress: "167-169 Great Portland Street, Fifth Floor, London, W1W 5PF",
  supportHours: "Monday-Friday, 9:00 AM-5:00 PM UK time",
  accountDeletionPath:
    "Profile -> Account -> Delete account",
  appleSubscriptionTermsUrl: "/subscriptions"
} as const;

export const primaryLinks = [
  { href: "/", label: "Home" },
  { href: "/#mission", label: "Mission" },
  { href: "/#meaning", label: "Why Egregor" },
  { href: "/#experience", label: "Experience" },
  { href: "/support", label: "Support" },
  { href: "/privacy", label: "Privacy" }
] as const;

export const policyLinks = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" },
  { href: "/subscriptions", label: "Subscription Terms" },
  { href: "/account-deletion", label: "Account Deletion" }
] as const;
