# Photoshop Integration Status

## Milestone

Current declared source milestone: **60%**

The 60% milestone adds the first permission-gated Photoshop writes on top of the 40% read-only UXP bridge.

## Source-supported foundation

- bounded Windows Program Files Photoshop detection,
- exact detected `Photoshop.exe` launch only,
- Photoshop UXP manifest v5 targeting host `PS` with Photoshop API v2,
- localhost pairing at `127.0.0.1:17363`,
- token-authenticated request/result bridge,
- read-only `inspect_context` and `list_layers`,
- exact request ID/action correlation,
- bounded 32-command queue,
- bounded document/layer receipt validation in Rust,
- high-risk `photoshop_set_layer_property` tool,
- allowed write properties only:
  - layer rename,
  - layer visibility,
  - layer opacity,
- exact expected document ID,
- exact layer ID,
- exact expected current property value,
- fresh pre-write context + layer inventory,
- Photoshop `executeAsModal`,
- history suspension around the mutation,
- history rollback on UXP-side exception,
- mutation receipt validation,
- independent post-write `list_layers` readback.

## Mutation safety boundary

A write is rejected when:

- the active document ID changed,
- the target layer no longer exists,
- the layer inventory is truncated,
- the inspected current property no longer equals `expected_value`,
- the requested value is the same as the current value,
- the operation is outside `rename | visible | opacity`,
- the host receipt does not exactly match the approved document/layer/operation/value,
- independent post-write readback does not show the approved final value.

A mutation timeout or pairing loss after dispatch is treated as `execution_status_unknown`; Shuvi must inspect the exact document/layer state before any retry.

## Still blocked at 60%

- delete layer,
- merge/flatten/rasterize,
- arbitrary `batchPlay`,
- pixel editing,
- selections and masks,
- text content/style editing,
- transforms,
- smart-object replacement,
- filters and adjustments,
- generative fill,
- save/export,
- destructive checkpoint/restore.

## Planned 80% milestone

1. Text-layer content/style editing.
2. Bounded layer transforms and adjustment controls.
3. Saved-document checkpoint evidence before higher-risk operations.
4. Recovery planning and richer post-write verification.

## Readiness

`source_runtime_verified=false`

`production_ready=false`

Real Photoshop runtime verification remains pending until a suitable Windows creative-app machine/server is available.
