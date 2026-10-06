# Photoshop Integration Status

## Milestone

Current declared source milestone: **20%**

This milestone intentionally implements only the safe Windows desktop foundation. It does not claim Photoshop document editing, a UXP host bridge, or runtime acceptance.

## Source-supported foundation

- bounded detection under Windows Program Files Adobe folders,
- exact `Adobe Photoshop*` candidate filtering,
- exact `Photoshop.exe` inventory,
- duplicate candidate suppression,
- permission-gated launch of a freshly detected executable,
- no arbitrary command-line arguments,
- capability report,
- readiness report,
- managed-process registration after launch.

## Not implemented in the 20% milestone

- UXP plugin/bridge transport,
- active document identity/readback,
- layer inventory/readback,
- selections/masks,
- text or smart-object editing,
- pixel/layer mutations,
- generative fill,
- export/save workflows,
- checkpoint/recovery,
- live Windows Photoshop acceptance.

## Planned 40% milestone

The next source milestone is the bounded read-only host bridge:

1. UXP bridge foundation.
2. Active document identity and dimensions.
3. Bounded layer inventory with stable host IDs where available.
4. Fresh request/receipt correlation.
5. No mutation until read-only identity and receipt safety are source-complete.

## Readiness

`source_runtime_verified=false`

`production_ready=false`

Real Photoshop runtime verification remains blocked until an appropriate Windows creative-app machine/server is available.
