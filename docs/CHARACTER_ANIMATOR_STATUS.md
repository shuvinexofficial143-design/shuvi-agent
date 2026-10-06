# Adobe Character Animator integration status

## Source milestone

Current declared source milestone: **80%**

This milestone extends the 60% permission-first runtime preflight with **bounded keyboard delivery for only three documented Character Animator application shortcuts**. It still does not claim a Character Animator scripting/host API, project inspection API, trigger-key delivery, MIDI delivery, effect verification, runtime acceptance, or production readiness.

## Implemented source scope

Desktop foundation:
- bounded Windows detection under standard `Program Files/Adobe` roots,
- `Support Files/Character Animator.exe` detection,
- exact freshly detected executable validation,
- managed process registration after launch.

Planning contract:
- documented application shortcut planning:
  - Record Take for Work Area → `Ctrl+3`
  - Export PNG Sequence and WAV → `Ctrl+Alt+M`
  - Export Frame → `Ctrl+Alt+S`
- project trigger-key planning only,
- MIDI-note planning only,
- Dynamic Link planning to After Effects and Premiere Pro,
- Adobe Media Encoder handoff planning.

80% bounded runtime delivery:
- requires normal Shuvi high-risk approval,
- requires `explicit_user_approval=true`,
- requires a non-zero expected Character Animator PID,
- requires that PID to be the exact live Shuvi-managed process identity,
- re-runs bounded Character Animator install detection and exact executable validation,
- performs the 60% foreground PID/path preflight,
- immediately rechecks foreground PID and executable path again inside the input-delivery process,
- maps the command to one fixed internal SendKeys sequence; arbitrary key strings are not accepted,
- supports only `record_take_work_area`, `export_png_wav`, and `export_frame`,
- fails closed if focus/PID/path changes,
- reports input dispatch separately from Character Animator effect verification.

## Automation boundary

No public Character Animator host scripting API is claimed.

`host_transport=not_implemented`

`future_host_transport=no_public_host_api_claimed`

The 80% adapter is deliberately narrow. It sends only the three fixed documented application shortcuts after target verification. It does not invent CEP, UXP, ExtendScript, project parsing, hidden host commands, trigger mapping discovery, or MIDI routing.

## Execution boundary

A successful 80% shortcut action may report:

- `managed_process_identity_verified=true`,
- `foreground_rechecked_immediately_before_send=true`,
- `input_dispatch_completed=true`,
- `effect_verified=false`,
- `project_trigger_execution=false`,
- `midi_execution=false`,
- `source_runtime_verified=false`,
- `production_ready=false`.

Input dispatch is **not** proof that Character Animator created a take, opened an export flow, or completed an export. A real Windows acceptance test remains separate.

## Explicitly not implemented at 80%

- project trigger-key input delivery,
- MIDI injection,
- host bridge,
- active project inspection,
- scene/puppet/timeline/take inspection,
- recording-result verification,
- export-result verification,
- project mutation APIs,
- Dynamic Link execution,
- Media Encoder export execution,
- runtime acceptance.

## Runtime status

`source_runtime_verified=false`

`production_ready=false`

Green CI does not change these flags.

## Next source phase

The 100% bounded source milestone should finalize a canonical Character Animator acceptance/completion summary and explicit runtime acceptance handoff while keeping unsupported host inspection, project trigger execution, MIDI delivery, and effect-success claims blocked unless separately verified.
