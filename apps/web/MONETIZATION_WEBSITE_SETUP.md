# Monetization Website Setup Checklist

Last updated: February 21, 2026

Use this file after deploying `apps/web` to your purchased domain.

## 1. Update your business details before launch

Edit `apps/web/app/site-config.ts` and replace placeholders:

- `supportPhone`
- `companyName`
- `companyAddress`
- `accountDeletionPath` (exact in-app navigation path)

## 2. Required public URLs

After deployment, confirm these load publicly without login:

- `https://egregor.world/support`
- `https://egregor.world/privacy`
- `https://egregor.world/terms`
- `https://egregor.world/subscriptions`
- `https://egregor.world/account-deletion`
- `https://egregor.world/sitemap.xml`
- `https://egregor.world/robots.txt`

## 3. App Store Connect mapping

Use these values in App Store Connect:

- `Support URL` -> `/support`
- `Privacy Policy URL` -> `/privacy`
- `Terms of Service` / legal URL -> `/terms`
- Auto-renewable subscription terms reference -> `/subscriptions`

Also required for payouts:

- Accept the `Paid Apps Agreement`.
- Complete `Banking` details.
- Complete `Tax` forms.

## 4. Google Play Console mapping

Use these values in Play Console:

- `Privacy policy` -> `/privacy`
- `Developer website` -> `/support`
- `Developer email` -> same support contact on `/support`
- `Account deletion URL` or web deletion entry point -> `/account-deletion`

Also required for payouts:

- Create and complete a `Google payments profile` / merchant setup.
- Complete your app `Data safety` form accurately.

## 5. Domain + deployment

1. Deploy `apps/web` to your host (Vercel, Netlify, Cloudflare Pages, etc.).
2. Attach your custom domain from GoDaddy in the hosting provider.
3. Add DNS records in GoDaddy exactly as provided by your host.
4. Wait for DNS propagation.
5. Verify HTTPS certificate is active.

## 6. Pre-submission QA

- Open every required URL on desktop and mobile.
- Ensure support page includes real email, address, and response hours.
- Ensure privacy policy matches actual app behavior and SDK usage.
- Ensure account deletion flow exists inside the app, not only on web.
- Ensure subscription prices in `/subscriptions` match store products.

## Official policy references

- Apple: App information and support URL fields
  - https://developer.apple.com/help/app-store-connect/reference/app-information
- Apple: Paid Apps Agreement, banking, and tax setup
  - https://developer.apple.com/help/app-store-connect/manage-agreements/sign-and-update-agreements/
  - https://developer.apple.com/help/app-store-connect/manage-your-financial-information/overview-of-banking-and-payments/
- Apple: App Review Guideline 3.1.2 (subscriptions)
  - https://developer.apple.com/app-store/review/guidelines/
- Apple: Privacy policy requirement context
  - https://developer.apple.com/app-store/app-privacy-details/
- Google Play: User Data (privacy policy requirement)
  - https://support.google.com/googleplay/android-developer/answer/10144311
- Google Play: Account deletion requirements
  - https://support.google.com/googleplay/android-developer/answer/13327111
- Google Play: Store listing contact details (email and address)
  - https://support.google.com/googleplay/android-developer/answer/9876937
