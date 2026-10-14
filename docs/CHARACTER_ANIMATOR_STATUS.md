# Adobe Character Animator integration status

## Source milestone

Current declared source milestone: **100%**

Character Animator's **bounded source scope is complete**. This means the agreed source integration has been implemented and closed with a canonical completion summary. It does **not** mean a real Windows Adobe Character Animator runtime has been accepted, and it does not promote production readiness.

## Implemented bounded source scope

Desktop foundation:
- bounded Windows detection under standard `Program Files/Adobe` roots,
- `Support Files/Character Animator.exe` detection,
- exact freshly detected executable validation,
- managed process registration and exact live-process identity binding after Shuvi launch.

Planning surfaces:
- documented application shortcut planning:
  - Record Take for Work Area → `Ctrl+3`
  - Export PNG Sequence and WAV → `Ctrl+Alt+M`
  - Export Frame → `Ctrl+Alt+S`
- user-project trigger-key planning,
- user-project MIDI-note planning,
- Dynamic Link planning to After Effects and Premiere Pro,
- Adobe Media Encoder handoff planning.

Permission-first runtime target verification:
- explicit user approval is required,
- exact Shuvi-managed Character Animator PID is required,
- freshly detected executable identity is required,
- foreground window PID and executable path are verified,
- target mismatch fails closed.

Bounded application-shortcut delivery:
- only the three fixed documented application shortcuts are executable,
- arbitrary runtime key strings are not accepted,
- foreground PID and executable path are rechecked immediately before input dispatch,
- input dispatch is reported separately from Character Animator effect success,
- project trigger-key runtime delivery remains blocked,
- MIDI runtime delivery remains blocked.

Canonical completion:
- `character_animator_acceptance_summary` reports the final bounded source scope,
- unsupported/unverified surfaces are explicitly listed,
- runtime acceptance remains a separate Windows-host phase.

## Automation boundary

No public Character Animator scripting/host API is claimed.

`host_transport=not_implemented`

`future_host_transport=no_public_host_api_claimed`

The completed source scope does not invent CEP, UXP, ExtendScript, hidden host commands, project parsing or scene/puppet/timeline APIs.

## Intentionally unclaimed after source completion

- active project inspection,
- scene/puppet/timeline/take inspection,
- project mutation APIs,
- project trigger-key runtime delivery,
- MIDI runtime delivery,
- recording-result verification,
- export-result verification,
- Dynamic Link execution,
- Media Encoder export execution,
- automatic proof that a dispatched shortcut achieved its requested Character Animator effect,
- runtime acceptance.

## Safety boundary

A shortcut action must pass:
- normal Shuvi permission approval,
- exact freshly detected Character Animator executable binding,
- exact live Shuvi-managed process identity,
- foreground PID and executable preflight,
- immediate foreground PID/executable recheck before dispatch.

Any uncertain or mismatched target fails closed. Input dispatch must never be described as verified recording/export success.

## Runtime status

`source_runtime_verified=false`

`host_ready_verified=false`

`production_ready=false`

Green CI validates source consistency; it does not change these runtime flags.

## Next phase

Run real Windows Character Animator acceptance testing on an installed Adobe host. Do not expand this source scope unless a new milestone is explicitly defined.
