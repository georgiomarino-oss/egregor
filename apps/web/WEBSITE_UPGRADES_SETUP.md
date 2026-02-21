# Website Upgrades Setup

This document covers the three upgrades now wired into `apps/web`:

1. Google Analytics 4 event tracking
2. Live support contact form delivery (Resend)
3. Optional CMS-managed website content (Sanity)

## 1) Analytics (GA4)

Set this Vercel environment variable:

- `NEXT_PUBLIC_GA_MEASUREMENT_ID` (example: `G-XXXXXXXXXX`)

After deploy, GA4 page views and custom events will be sent automatically.
Current custom event:

- `support_contact_submitted`

## 2) Contact Form Backend (Resend)

The support page now posts to `POST /api/contact`.

Set these Vercel environment variables:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` (must be a verified sender/domain in Resend)
- `CONTACT_TO_EMAIL` (optional, defaults to `support@egregor.co.uk`)

Behavior:

- Input validation on name/email/topic/message
- Honeypot field spam filtering
- Basic per-IP rate limiting
- On service failure, user sees fallback to direct support email

## 3) CMS Content (Sanity, Optional)

If these variables are not set, the site uses built-in default copy.

Set these Vercel environment variables to enable CMS content:

- `SANITY_PROJECT_ID`
- `SANITY_DATASET`
- `SANITY_API_VERSION` (optional, default: `v2025-02-19`)
- `SANITY_API_READ_TOKEN` (optional; needed if dataset is private)

Expected Sanity document:

- `_type`: `siteContent`
- `slug.current`: `website`

The app queries one `siteContent` document and merges it with defaults so missing
fields do not break rendering.

## Suggested Sanity schema (starter)

```ts
// siteContent
{
  name: "siteContent",
  type: "document",
  fields: [
    { name: "slug", type: "slug", options: { source: "title" } },
    { name: "hero", type: "object", fields: [/* kicker, title, lead, body... */] },
    { name: "mission", type: "object", fields: [/* title, paragraphOne, paragraphTwo, pillars[] */] },
    { name: "meaning", type: "object", fields: [/* title, meaningTitle, meaningBody, fitTitle, fitBody */] },
    { name: "experience", type: "object", fields: [/* title, steps[] */] },
    { name: "trust", type: "object", fields: [/* title, intro, cards[] */] },
    { name: "finalCta", type: "object", fields: [/* title, body */] },
    { name: "support", type: "object", fields: [/* title, intro, formTitle, formDescription, topics[] */] }
  ]
}
```

## Deployment Checklist

1. Add env vars in Vercel Project Settings.
2. Redeploy production.
3. Test:
   - `https://egregor.world/support` form submission
   - GA4 realtime event stream
   - CMS copy change reflected after revalidation window
