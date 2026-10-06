# Adobe Character Animator integration status

## Source milestone

Current declared source milestone: **60%**

This milestone extends the 40% planning contract with a bounded **permission-first runtime preflight**. It still does not send keyboard or MIDI input and does not claim a Character Animator scripting/host API.

## Implemented source scope

Desktop foundation:
- bounded Windows detection under standard `Program Files/Adobe` roots,
- `Support Files/Character Animator.exe` detection,
- exact freshly detected executable validation,
- managed process registration after launch.

Supported planning contract:
- documented Windows application shortcut planning:
  - Record Take for Work Area → `Ctrl+3`
  - Export PNG Sequence and WAV → `Ctrl+Alt+M`
  - Export Frame → `Ctrl+Alt+S`
- user-project trigger-key planning,
- user-project MIDI-note planning,
- Dynamic Link planning to After Effects and Premiere Pro,
- Adobe Media Encoder handoff planning.

60% runtime preflight:
- requires `explicit_user_approval=true`,
- requires a non-zero expected Character Animator PID,
- requires that PID to be the exact live Shuvi-managed process identity,
- re-runs bounded Character Animator install detection and exact executable validation,
- reads the actual Windows foreground window PID,
- reads the foreground process executable path,
- requires both foreground PID and canonical executable path to exactly match the approved Character Animator target,
- fails closed on any mismatch,
- does not send keyboard or MIDI input.

## Automation boundary

No public Character Animator host scripting API is claimed.

`host_transport=not_implemented`

`future_host_transport=no_public_host_api_claimed`

The runtime adapter is currently **preflight-only**. It proves that Shuvi can bind a future control action to the exact approved, Shuvi-managed Character Animator foreground process without inventing CEP, UXP, ExtendScript, project parsing, or hidden host commands.

## Execution boundary

The 60% runtime preflight reports:

- `managed_process_identity_verified=true` only after Shuvi's existing managed-process identity guard passes,
- `foreground_process_verified=true` only after exact PID + canonical executable match,
- `explicit_user_approval=true`,
- `input_delivery_implemented=false`,
- `execution_supported=false`,
- `mutation_performed=false`,
- `source_runtime_verified=false`,
- `production_ready=false`.

Planning requests remain execution-free.

## Explicitly not implemented at 60%

- keyboard input delivery,
- trigger-key input delivery,
- MIDI injection,
- host bridge,
- active project inspection,
- scene/puppet/timeline/take inspection,
- recording execution,
- project mutation,
- Dynamic Link execution,
- export execution,
- runtime acceptance.

## Runtime status

`source_runtime_verified=false`

`production_ready=false`

Green CI does not change these flags. No live Character Animator runtime acceptance is claimed by this source milestone.

## Next source phase

The 80% milestone may add bounded keyboard delivery for the documented application shortcuts only if an immediate pre-send focus recheck remains fail-closed. Trigger-key delivery should remain separately guarded by project mapping, MIDI delivery should remain blocked until a reliable route is implemented, and project/scene/puppet host inspection remains blocked without an authoritative Adobe API.
