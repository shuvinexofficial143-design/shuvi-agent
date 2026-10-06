# Adobe Animate integration status

## Source milestone

Current declared source milestone: **20%**

This milestone establishes only the bounded desktop foundation for Shuvi's Adobe Animate integration. It does **not** claim a working Animate scripting bridge, document automation, runtime acceptance, or production readiness.

## Implemented source scope

- bounded Windows detection under standard `Program Files/Adobe` roots,
- support for detected `Animate.exe` / `Adobe Animate.exe`,
- exact freshly detected executable validation before launch,
- Shuvi managed-process registration after launch,
- source capability report,
- source readiness report.

## Explicitly not implemented at 20%

- Animate host bridge / scripting transport,
- document, scene, timeline, layer or library inspection,
- symbol/instance inspection,
- timeline edits,
- drawing or asset mutation,
- publish/export automation,
- real-host acceptance.

## Runtime status

`source_runtime_verified=false`

`production_ready=false`

A successful source build or CI run must not change either runtime flag. Real Adobe Animate host testing is a later acceptance phase.

## Next source phase

The 40% milestone should first select and implement a bounded Animate host transport and expose read-only document/timeline context. Mutation should remain blocked until exact host/document identity can be inspected and guarded.
