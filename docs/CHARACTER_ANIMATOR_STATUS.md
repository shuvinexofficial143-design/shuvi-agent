# Adobe Character Animator integration status

## Source milestone

Current declared source milestone: **20%**

This milestone establishes only Shuvi's bounded Windows desktop foundation for Adobe Character Animator. It does **not** claim a working Character Animator host bridge, project automation, runtime acceptance, or production readiness.

## Implemented source scope

- bounded Windows detection under standard `Program Files/Adobe` roots,
- support for the normal Windows executable layout under `Support Files/Character Animator.exe`,
- fallback detection for a directly nested `Character Animator.exe` without broad filesystem searching,
- exact freshly detected executable validation before launch,
- Shuvi managed-process registration after launch,
- source capability report,
- source readiness report.

Adobe's current Character Animator system requirements confirm the current desktop product line. Historical Adobe crash diagnostics also show the Windows executable as `Character Animator.exe` under the application's `Support Files` directory. The 20% source milestone uses only that bounded desktop evidence; no host scripting surface is assumed.

## Automation transport boundary

No current public Character Animator automation surface is claimed here.

`future_host_transport=research_required`

Before any 40% host integration is written, Shuvi must verify an authoritative supported automation/control surface. If none is available, the integration stays fail-closed rather than inventing CEP, UXP, ExtendScript, or another transport.

## Explicitly not implemented at 20%

- host bridge,
- active project inspection,
- scene inspection,
- puppet inspection,
- timeline/take inspection,
- recording control,
- project mutation,
- export automation,
- runtime acceptance.

## Runtime status

`source_runtime_verified=false`

`production_ready=false`

Green source tests or CI must not change either flag. A real Windows Character Animator runtime phase is separate.

## Next source phase

The 40% milestone may begin only after an authoritative Character Animator automation surface is verified. Until then, project/scene/puppet automation remains blocked.
