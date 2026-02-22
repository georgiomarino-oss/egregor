# Egregor Logo Rollout

Canonical logo source:
- `mobile/EGREGOR_LOGO_SOURCE.svg`
- `apps/web/app/brand-logo.tsx` (same geometry embedded for web runtime)

## App Cover / Store Assets

Use `mobile/EGREGOR_LOGO_SOURCE.svg` to export these PNG assets:

1. `icon-1024.png` (1024x1024)
2. `adaptive-foreground-1024.png` (1024x1024, transparent bg)
3. `splash-logo-2048.png` (2048x2048)

Recommended export rules:
- Keep a 12% safe margin around the outer ring.
- Preserve original colors (no re-tint).
- Use transparent background for adaptive foreground.

## Expo Config Targets

After exporting files, wire them in `mobile/app.json`:

```json
{
  "expo": {
    "icon": "./assets/icon-1024.png",
    "splash": {
      "image": "./assets/splash-logo-2048.png"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-foreground-1024.png",
        "backgroundColor": "#071423"
      }
    }
  }
}
```

## Shared Surface Targets

Apply the same logo mark on:
- Website header/footer
- Mobile app icon + splash
- Browser extension icon set (16/32/48/128)
- Social/profile avatars
