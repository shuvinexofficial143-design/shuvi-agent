# Adobe Illustrator integration status

## Source milestone

Current declared source milestone: **20%**

This milestone establishes only Shuvi's bounded Windows desktop foundation for Adobe Illustrator. It does **not** claim a working Illustrator scripting bridge, document automation, runtime acceptance, or production readiness.

## Implemented source scope

- bounded Windows detection under standard `Program Files/Adobe` roots,
- support for the normal Illustrator Windows executable layout under `Support Files/Contents/Windows/Illustrator.exe`,
- fallback detection for a directly nested `Illustrator.exe` without broad filesystem searching,
- exact freshly detected executable validation before launch,
- Shuvi managed-process registration after launch,
- source capability report,
- source readiness report.

## Planned host transport

Adobe Illustrator supports JavaScript/ExtendScript scripting. Adobe CEP documentation identifies Illustrator with host ID `ILST` and supports calling host ExtendScript from a CEP extension.

Therefore the next source phase is planned as a bounded authenticated **CEP + ExtendScript** transport. This milestone does not implement or claim that bridge yet.

## Explicitly not implemented at 20%

- CEP/ExtendScript host bridge,
- active document inspection,
- artboard inspection,
- layer/page-item inspection,
- selection inspection,
- Illustrator mutation,
- save/export automation,
- runtime acceptance.

## Runtime status

`source_runtime_verified=false`

`production_ready=false`

Green source tests or CI must not change either flag. A real Windows Illustrator host acceptance run belongs to a later runtime phase.

## Next source phase

The 40% milestone should add an authenticated bounded localhost CEP/ExtendScript bridge and expose read-only active-document/artboard context before any mutation is considered.
