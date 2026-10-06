# Adobe Illustrator integration status

## Source milestone

Current declared source milestone: **60%**

The 60% milestone extends the bounded read-only CEP + ExtendScript bridge with layer, page-item and selection inspection plus fresh document identity rechecks. It still does **not** authorize Illustrator mutation.

## Implemented source scope

Desktop foundation:
- bounded Windows detection,
- exact detected Illustrator executable launch,
- managed-process tracking.

Authenticated host transport:
- localhost bridge on `127.0.0.1:17365`,
- rotating pairing token,
- bounded request/result queue,
- CEP host ID `ILST`,
- CEP `evalScript` to ExtendScript adapter.

Read-only inspection:
- active document context,
- document path and saved state where exposed,
- artboard inventory and active artboard,
- bounded top-level layer inventory (maximum 256),
- layer name, visibility, lock state, opacity, nested-layer/page-item counts,
- bounded document page-item inventory (maximum 256),
- page-item type/name/layer, lock/hidden state, opacity and geometric bounds,
- bounded current selection inventory (maximum 64),
- observational per-layer and per-item signatures,
- observational selection snapshot signature,
- fresh exact document-signature recheck through `verify_identity`,
- independent Rust-side receipt validation.

## Read-only allowlist

- `inspect_context`
- `inspect_artboards`
- `inspect_layers`
- `inspect_page_items`
- `inspect_selection`
- `verify_identity`

The native bridge has an empty mutation allowlist at this milestone.

## Identity boundary

The document, layer, item and selection signatures in the 60% milestone are bounded observational snapshots. They are intended for stale-target detection and future write preconditions; they are **not** represented as permanent Illustrator object IDs.

A successful `verify_identity` result reports `mutationAuthorized=false`. Identity confirmation alone never grants write permission.

## Explicitly not implemented at 60%

- layer/object mutation,
- create/delete/reorder operations,
- text/path/appearance mutation,
- save or Save As,
- export automation,
- arbitrary ExtendScript execution,
- automatic rollback,
- runtime acceptance.

## Runtime status

`source_runtime_verified=false`

`production_ready=false`

Green source tests and CI do not change these flags. Real Windows Illustrator acceptance remains pending.

## Next source phase

The 80% milestone should introduce only a very small typed guarded mutation surface, with exact fresh document/target-state preconditions, checkpoint/recovery strategy, independent readback, and no arbitrary ExtendScript.
