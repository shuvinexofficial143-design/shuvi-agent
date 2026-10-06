# Photoshop Integration Status

## Milestone

Current declared source milestone: **40%**

The 40% milestone keeps Photoshop read-only. It adds the bounded UXP host-observation path on top of the 20% detect/launch foundation.

## Source-supported foundation

- bounded Windows Program Files Photoshop detection,
- exact detected `Photoshop.exe` launch only,
- Photoshop UXP manifest v5 targeting host `PS`,
- network permission limited to `http://127.0.0.1:17363`,
- authenticated localhost pairing token,
- read-only bridge actions: `inspect_context` and `list_layers`,
- exact request ID/action correlation,
- bounded outstanding command queue,
- active document ID/title/dimensions/resolution/mode readback,
- active layer IDs,
- bounded layer inventory: maximum 256 layers and depth 8,
- duplicate layer ID rejection,
- Rust-side validation of UXP receipts,
- bridge start/status/stop,
- capability and readiness reports.

## Safety boundary

No document or layer mutation is implemented at 40%.

The UXP panel cannot request arbitrary host actions through Shuvi. Its native command allowlist contains only `inspect_context` and `list_layers`. Rust validates every returned document/layer receipt before exposing it as evidence.

Pairing is localhost-only, token-authenticated, time-bounded, queue-bounded, and invalidated by stop/token rotation.

## Not implemented yet

- layer rename/visibility/opacity writes,
- text editing,
- selections/masks,
- transforms,
- smart objects,
- filters/adjustments,
- pixel mutations,
- generative fill,
- save/export,
- checkpoint/recovery,
- live Windows Photoshop acceptance.

## Planned 60% milestone

1. Exact expected document identity for mutations.
2. Small permission-gated layer/document write allowlist.
3. Fresh pre-write inspection.
4. Post-write readback.
5. Safe checkpoint/duplicate-document boundary before destructive operations.

## Readiness

`source_runtime_verified=false`

`production_ready=false`

Real Photoshop runtime verification remains pending until a suitable Windows creative-app machine/server is available.
