# Photoshop Integration Status

## Source milestone

Current declared source milestone: **100%**

This means the bounded Photoshop integration scope defined for Shuvi is source-complete. It does **not** mean every Photoshop feature is implemented, and it does not claim live Photoshop runtime verification or production readiness.

## Implemented source scope

### Desktop foundation
- bounded Windows Photoshop detection,
- exact detected `Photoshop.exe` launch,
- capability/readiness reports,
- managed-process tracking.

### UXP bridge
- Photoshop UXP manifest v5 / API v2,
- localhost-only `127.0.0.1:17363`,
- rotating pairing token,
- bounded queue and request/result identity,
- timeout handling,
- mutation timeout/pairing loss becomes `execution_status_unknown`,
- blind retry is not allowed.

### Read-only inspection
- active document ID/title/dimensions/resolution/mode,
- saved state,
- cloud/local state,
- exact document path where available,
- active layer IDs,
- bounded layer tree (256 entries, depth 8),
- layer ID/name/kind/visibility/opacity,
- lock state,
- optional bounds,
- text contents/font size,
- layer-mask density/feather when available.

### Guarded layer writes
- rename,
- visibility,
- opacity.

### Guarded advanced writes
- text contents,
- text font size,
- translate,
- scale,
- rotate,
- layer-mask density,
- layer-mask feather.

All advanced writes require fresh exact document/layer identity and post-write readback. Text, transforms, and mask edits additionally require a clean saved local PSD/PSB checkpoint before the host mutation.

### Checkpoints
- byte-for-byte local PSD/PSB backup,
- source/backup FNV-1a integrity fingerprints,
- sidecar bound to source path + Photoshop document ID,
- read-only checkpoint verification,
- no automatic restore.

### Guarded document save
`photoshop_save_document` is limited to an existing local PSD/PSB.

It requires:
- exact active document ID,
- exact current document path,
- latest inspected `saved=false`,
- non-cloud document,
- a verified pre-save disk checkpoint.

Only then does the UXP host call `Document.save()`. Shuvi independently re-inspects the document afterward and requires the same ID/path with `saved=true`.

No arbitrary Save As or arbitrary export path is claimed. Standard UXP Save As/export requires a UXP file entry/token or user file-picker boundary; Shuvi does not bypass that security model.

## Canonical completion summary

`photoshop_acceptance_summary` exposes the declared source scope, safety gates, and deliberately unclaimed features.

It reports:
- source milestone 100%,
- source scope complete,
- runtime verification false,
- production ready false.

## Intentionally unclaimed

The 100% source milestone does **not** claim:

- arbitrary `batchPlay`,
- layer delete / merge / flatten / rasterize,
- arbitrary pixel mutation,
- unrestricted filters,
- generative fill,
- automatic checkpoint restore,
- arbitrary-path Save As/export without UXP file-token/user boundary.

These are excluded deliberately rather than represented as fake capabilities.

## Safety gates

- permission-first typed mutation tools,
- high-risk approval for mutations/disk writes,
- exact document/layer/path identity,
- fresh expected-state preconditions,
- bounded numeric/text limits,
- modal Photoshop mutation context,
- Photoshop history suspension for reversible host mutations,
- local PSD/PSB checkpoints before advanced/disk writes,
- host receipt validation,
- independent post-write readback,
- execution-status-unknown handling with no blind retry.

## Runtime readiness

`source_runtime_verified=false`

`production_ready=false`

A real Windows Photoshop acceptance run is still required before either flag can become true.
