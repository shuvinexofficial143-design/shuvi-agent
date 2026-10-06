# Adobe Animate integration status

## Source milestone

Current declared source milestone: **40%**

The 40% milestone adds a bounded **read-only** Animate host transport on top of the 20% desktop foundation. It does not authorize any Animate document mutation.

## Implemented source scope

- bounded Windows detection and exact detected executable launch,
- managed-process tracking,
- authenticated localhost bridge on `127.0.0.1:17364`,
- rotating pairing token and bounded request/result queue,
- CEP panel targeted at Animate host ID `FLPR`,
- CEP `evalScript` → JSFL host adapter,
- read-only active document context,
- read-only current timeline/layer/frame summary,
- bounded layer inventory (maximum 256; Shuvi tool currently requests 128),
- document signature for later stale-document guards,
- independent Rust-side receipt validation,
- source capability/readiness reporting.

Adobe's Animate documentation exposes the Animate JavaScript API/JSFL for authoring automation, and Adobe's Animate HTML-extension documentation describes CEP `evalScript` as the route for running JSFL from an extension. The bridge therefore uses CEP + JSFL rather than pretending Animate has the same UXP surface as Premiere/Photoshop.

## Read-only allowlist

- `inspect_context`
- `inspect_timeline`

No other native action is accepted by the bridge at this milestone.

## Explicitly not implemented at 40%

- library/symbol inventory beyond timeline frame summaries,
- exact selected-element inspection,
- timeline/layer/frame mutation,
- drawing/stage mutation,
- symbol/instance mutation,
- ActionScript edits,
- publish/export automation,
- save/Save As,
- runtime acceptance.

## Runtime status

`source_runtime_verified=false`

`production_ready=false`

CI/source completion does not promote either flag. A real Windows Animate host acceptance run is still required later.

## Next source phase

The 60% milestone should add bounded library/symbol/selection inspection and stronger exact document/timeline identity guards while keeping mutation blocked until those identities can be rechecked immediately before writes.
