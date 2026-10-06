# Photoshop Integration Status

## Milestone

Current declared source milestone: **80%**

The 80% milestone extends the guarded Photoshop bridge with checkpoint-bound text editing and bounded layer transforms.

## Source-supported foundation

- bounded Windows Photoshop detection and exact launch,
- Photoshop UXP manifest v5 / API v2,
- localhost token-paired bridge,
- bounded request/result correlation,
- document context with saved/cloud/path evidence,
- bounded layer inventory with IDs, locks, bounds and text metadata,
- guarded layer rename / visibility / opacity,
- text-layer content editing,
- text font-size editing,
- bounded layer translate / scale / rotate,
- fresh exact document/layer preconditions,
- `executeAsModal`,
- Photoshop history suspension + cancel-on-error,
- host mutation receipt validation,
- independent post-write layer readback,
- saved local PSD/PSB checkpoint copy before text/transform writes,
- checkpoint sidecar binding source path, document ID, file size and FNV-1a integrity fingerprint,
- read-only checkpoint verification / recovery evidence,
- no automatic restore.

Adobe documents text editing through `TextItem.contents` and `TextItem.characterStyle.size`, and exposes `Layer.translate`, `Layer.scale`, and `Layer.rotate` as layer transform APIs. Photoshop state-changing operations remain wrapped in `executeAsModal`.

## Checkpoint boundary

Text and transform operations require:

1. the active document is saved,
2. it is a local PSD/PSB (not cloud-only),
3. its absolute path is available,
4. a byte-for-byte backup copy is created in `Shuvi Photoshop Backups`,
5. source and backup fingerprints match,
6. a sidecar binds checkpoint evidence to the document ID and source path.

If any checkpoint step fails, the Photoshop host mutation is not sent.

`photoshop_verify_checkpoint` verifies the backup and its sidecar but never restores automatically.

## Text edit safety

Text writes require the exact latest:

- document ID,
- layer ID,
- text contents,
- font size.

Only replacement contents and font size are supported in this milestone. If the target is not an inspected text layer, is locked, or the expected text state changed, the write is rejected.

## Transform safety

Supported transforms:

- translate: each axis bounded to ±10,000 px,
- scale: 1%..1000% per axis,
- rotate: ±360°.

The layer must be unlocked and position-unlocked. Exact pre-transform bounds must match the fresh inventory. The mutation receipt must show geometric change, and a separate post-write inventory must match the receipt's final bounds.

## Still blocked at 80%

- layer deletion,
- merge / flatten / rasterize,
- arbitrary `batchPlay`,
- arbitrary pixel editing,
- unrestricted filters,
- generative fill,
- automatic checkpoint restore,
- live runtime acceptance.

## Planned 100% source milestone

1. bounded selection/mask and adjustment-layer controls where host APIs are explicit,
2. bounded smart-object replacement/export workflows where exact APIs and readback are available,
3. canonical Photoshop acceptance summary,
4. final source safety audit,
5. keep generative fill / arbitrary pixel mutation unclaimed unless a later verified scope explicitly adds them.

## Readiness

`source_runtime_verified=false`

`production_ready=false`

Real Photoshop runtime verification remains pending until a suitable Windows Photoshop environment is available.
