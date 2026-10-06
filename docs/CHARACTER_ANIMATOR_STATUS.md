# Adobe Character Animator integration status

## Source milestone

Current declared source milestone: **40%**

This milestone extends Shuvi's 20% Windows desktop foundation with a bounded **planning-only control and interchange contract** based on Character Animator workflows Adobe documents publicly. It still does not claim a Character Animator scripting/host API.

## Implemented source scope

Desktop foundation:
- bounded Windows detection under standard `Program Files/Adobe` roots,
- `Support Files/Character Animator.exe` detection,
- exact freshly detected executable validation,
- managed process registration after launch.

Planning-only supported control contract:
- documented Windows application shortcut plan:
  - Record Take for Work Area → `Ctrl+3`
  - Export PNG Sequence and WAV → `Ctrl+Alt+M`
  - Export Frame → `Ctrl+Alt+S`
- user-project trigger-key planning,
- user-project MIDI-note planning,
- project-mapping acknowledgement for trigger/MIDI plans,
- no keyboard/MIDI input execution.

Planning-only interchange contract:
- Dynamic Link to After Effects,
- Dynamic Link to Premiere Pro,
- Character Animator → Adobe Media Encoder export handoff,
- bounded absolute `.chproj` path and scene-name validation,
- no Dynamic Link/import/export execution.

## Automation boundary

No public Character Animator host scripting API is claimed.

`host_transport=not_implemented`

`future_host_transport=no_public_host_api_claimed`

The 40% source milestone intentionally uses only a planning contract over documented control and interchange surfaces. It does not invent CEP, UXP, ExtendScript, project parsing, or hidden host commands.

## Execution boundary

Every 40% control/interchange plan reports:

- `execution_supported=false`
- `mutation_performed=false`
- `source_runtime_verified=false`
- `production_ready=false`

A trigger key or MIDI note is project-specific. Shuvi requires explicit acknowledgement that the user/project mapping exists but does not claim that mapping has been runtime verified.

## Explicitly not implemented at 40%

- keyboard injection,
- MIDI injection,
- focused-window verification,
- host bridge,
- active project inspection,
- scene/puppet/timeline/take inspection,
- recording execution,
- project mutation,
- export execution,
- runtime acceptance.

## Runtime status

`source_runtime_verified=false`

`production_ready=false`

Green CI does not change these flags.

## Next source phase

The 60% milestone may add a permission-first runtime adapter for documented Character Animator keyboard/trigger/MIDI control only if reliable focused-window and input-delivery verification can be represented safely. Project/scene/puppet host inspection remains blocked unless Adobe exposes an authoritative supported API.
