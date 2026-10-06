# Adobe Illustrator integration status

## Source milestone

Current declared source milestone: **40%**

The 40% milestone adds a bounded authenticated **CEP + ExtendScript** read-only host transport on top of the 20% desktop foundation. It does not authorize Illustrator document mutation.

## Implemented source scope

- bounded Windows detection and exact detected executable launch,
- managed-process tracking,
- authenticated localhost bridge on `127.0.0.1:17365`,
- rotating pairing token and bounded request/result queue,
- CEP panel targeted at Illustrator host ID `ILST`,
- CEP `evalScript` to ExtendScript host adapter,
- read-only active-document context,
- document name/path/saved state where exposed,
- bounded counters for artboards, layers, page items and selection,
- active artboard index,
- read-only bounded artboard inventory (maximum 256; Shuvi requests 128),
- artboard names and rectangles,
- observational document signature for later stale-context guards,
- independent Rust-side receipt validation.

## Read-only allowlist

- `inspect_context`
- `inspect_artboards`

No other native Illustrator action is accepted by the bridge at this milestone.

## Identity boundary

The 40% observational document signature is not represented as a permanent Illustrator object ID. It is read-only groundwork for stronger exact identity guards in later milestones.

## Explicitly not implemented at 40%

- layer/page-item detail inventory,
- selected-object detail inspection,
- Illustrator document or object mutation,
- save/Save As,
- export automation,
- arbitrary ExtendScript execution,
- runtime acceptance.

## Runtime status

`source_runtime_verified=false`

`production_ready=false`

CI/source completion does not promote either flag. Real Windows Illustrator acceptance remains a later phase.

## Next source phase

The 60% milestone should add bounded layer/page-item/selection inspection and stronger exact document/target identity guards while keeping mutation blocked.
