# Adobe Animate integration status

## Source milestone

Current declared source milestone: **60%**

The 60% milestone extends the bounded read-only CEP + JSFL bridge with library/symbol metadata, stage-selection inspection, and fresh document/timeline identity rechecks. It still does **not** authorize any Animate mutation.

## Implemented source scope

- bounded Windows detection and exact detected executable launch,
- managed-process tracking,
- authenticated localhost bridge on `127.0.0.1:17364`,
- rotating pairing token and bounded request/result queue,
- CEP panel targeted at Animate host ID `FLPR`,
- CEP `evalScript` → JSFL host adapter,
- read-only active document context,
- read-only current timeline/layer/frame summary,
- bounded layer inventory (maximum 256),
- bounded library inventory (maximum 256) with item type, symbol metadata, linkage metadata and nested symbol-timeline counts where exposed,
- bounded selected-stage-element inspection (maximum 64) with instance/library references where exposed,
- observational library/selection snapshot signatures that are explicitly **not** treated as stable object IDs or full content fingerprints,
- document signature and timeline signature,
- fresh exact document/timeline signature recheck through `verify_identity`,
- independent Rust-side receipt validation,
- source capability/readiness reporting.

Animate's authoring model includes timelines, library items/symbols, and reusable symbol instances. Shuvi uses those surfaces only for bounded inspection in this milestone.

## Read-only allowlist

- `inspect_context`
- `inspect_timeline`
- `inspect_library`
- `inspect_selection`
- `verify_identity`

No native mutation action is accepted by the bridge at 60%.

## Identity boundary

`verify_identity` re-inspects the live host and requires exact equality with the previously inspected document and timeline signatures. A successful identity recheck is only a stale-target guard. It does not authorize a future edit by itself.

Selection and library signatures are observational snapshots because Animate stage elements do not expose a Shuvi-defined persistent object ID in this source scope. Shuvi therefore does not represent them as permanent identities.

## Explicitly not implemented at 60%

- timeline/layer/frame mutation,
- stage/drawing mutation,
- symbol/instance mutation,
- library mutation,
- ActionScript edits,
- publish/export automation,
- save/Save As,
- automatic rollback,
- runtime acceptance.

## Runtime status

`source_runtime_verified=false`

`production_ready=false`

CI/source completion does not promote either flag. A real Windows Animate host acceptance run is still required later.

## Next source phase

The 80% milestone should introduce a small set of typed, low-risk guarded mutations only after fresh document/timeline identity checks, with checkpoint/recovery planning and independent post-write readback. No arbitrary JSFL execution should be exposed.
