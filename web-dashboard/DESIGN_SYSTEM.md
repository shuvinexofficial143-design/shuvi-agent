# Shuvi Control Center — Midnight Sapphire theme

Approved UI direction: **Midnight Sapphire**. Apply this to all browser UI sections in `web-dashboard` (Dashboard, AI Chat, Creative Studio, Tools, Tasks, AI Models, Activity, Settings).

## Primary palette

| Token | Color | Use |
|---|---|---|
| Background | `#0B1220` | Main desktop canvas and sidebar backgrounds |
| Surface | `#1E293B` | Raised panels, controls and card surfaces |
| Primary | `#2563EB` | Buttons, active navigation and primary actions |
| Secondary | `#7DD3FC` | Active hints, outlines and icon accents |
| Text | `#F8FAFC` | High-contrast text |

Use softer derived intermediate colors for shadows, borders, and gradients. Semantic warnings/errors/success retain clear status colors; do not recolor an offline status as online.

## Implementation

- `src/premium-theme.css` owns the design tokens and styles layered after `src/styles.css`.
- `src/appearance.ts` controls the `data-palette` attribute on the root and local `shuvi.web.palette.v2` preference. Default `sapphire`. Older `shuvi.web.palette.v1` preferences are intentionally ignored so former Ember users receive the approved blue design on update.
- Settings shows **Midnight Sapphire** selected first, plus optional Arctic Violet, Teal Matrix, and Steel Monochrome. Changing appearance is web-only and does not run or approve local Shuvi actions.
- No external font assets or network calls have been added.
- Dark-theme contrast, focus outlines, mobile layouts and `prefers-reduced-motion` remain part of UI acceptance.

## Validation

Run in `web-dashboard`:

```powershell
npm install
npm test
npm run build
npm run dev -- --host 127.0.0.1 --port 1421 --strictPort
```

Review `http://127.0.0.1:1421` and check each section plus the four theme buttons in Settings.

## Scope

**Theme work only.** Browser pages do not gain real Adobe/Blender permissions, runtime pairing, or true parallel chat execution from this visual update. Local execution and approvals stay gated by Shuvi's existing native runtime.
