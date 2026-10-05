# Shuvi fixed Remotion runtime

This directory is an isolated, reviewed renderer for Shuvi's deterministic `motion_graphics_plan_remotion` manifest.

## Safety contract

- No provider-generated React/TypeScript/JavaScript is accepted or executed.
- The entry point is fixed to `src/index.mjs`.
- Only manifest layer kinds already allowed by Shuvi are rendered.
- Local image/video assets are copied into a temporary public snapshot before bundling, and each staged asset is SHA-256 recorded.
- Review PNGs are rendered only at the manifest's bounded review sample times.
- Standalone final output uses H.264 `.mp4`.
- Transparent overlay output uses the fixed ProRes 4444 `.mov` route with PNG frames, `yuva444p10le`, and profile `4444`.
- A successful render does not yet claim that the alpha channel was independently probed, nor that Claude approved the visuals. Those remain explicit evidence blockers.

## Install

Run `npm install` inside this directory. Remotion packages are intentionally exact-version pinned and must stay aligned.

## Render examples

Preview frames only:

`node render.mjs --manifest C:\path\manifest.json --preview-dir C:\path\preview`

Preview plus final standalone video:

`node render.mjs --manifest C:\path\manifest.json --preview-dir C:\path\preview --output C:\path\motion.mp4`

Transparent overlay:

`node render.mjs --manifest C:\path\manifest.json --preview-dir C:\path\preview --output C:\path\overlay.mov`

The command writes a bounded evidence JSON receipt alongside the final output (or inside the preview directory when no final output is requested).
