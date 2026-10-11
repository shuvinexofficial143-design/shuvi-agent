# Adobe Substance 3D integration status

## Source milestone

Current declared source milestone: **80%**

The 80% milestone adds bounded readback evidence on top of the 60% Painter/Sampler runtime adapters. It does not make the integration runtime-accepted or production-ready.

## Painter read-only remote receipt

Adobe documents Painter remote control through localhost port 60041, route `/run.json`, base64 encoded JavaScript/Python payloads, and the read-only JavaScript example `alg.version.painter`.

Shuvi now allows exactly one remote read query:

- `query=api_version`
- fixed command: `alg.version.painter`

Before dispatch Shuvi requires:
- explicit user approval,
- exact live Shuvi-managed Painter PID,
- fresh exact detected Painter executable binding,
- proof via Windows `Get-NetTCPConnection` that the expected Painter PID owns listening port 60041.

Only after those checks does Shuvi POST the fixed command to `/run.json`. No arbitrary JS/Python string can be supplied through the tool contract.

The receipt reports:
- exact managed PID,
- endpoint owner PID,
- fixed documented command,
- returned JSON value,
- `read_receipt_verified=true`,
- `mutation_performed=false`.

## Sampler completion receipt

The 60% approved `.py` launch remains hash-bound to a fresh SHA-256. At 80%, the launch can optionally include:
- an absolute `.json` receipt target that must not already exist,
- a bounded request ID.

When both are supplied, Shuvi injects:
- `SHUVI_SAMPLER_RECEIPT_PATH`
- `SHUVI_SAMPLER_REQUEST_ID`
- `SHUVI_SAMPLER_SCRIPT_SHA256`

into the Sampler process environment. This is a **Shuvi receipt contract**, not an Adobe-native completion API. An approved script may write a receipt with:
- `schema_version: 1`
- exact `request_id`
- exact approved `script_sha256`
- `status: "completed"`

The separate verification tool validates that receipt with bounded file size and exact identity/hash binding.

A valid receipt means:
- `script_completion_receipt_verified=true`

It does **not** mean:
- a specific material/render/export effect was correct,
- Adobe Sampler emitted a native completion signal.

Therefore:
- `script_effect_verified=false`
- `native_sampler_completion_signal_verified=false`

## Still blocked

- arbitrary Painter JavaScript/Python remote commands,
- Painter mutating remote commands,
- Designer plugin install/execution,
- Stager/Modeler scripting without authoritative support,
- project/material/texture-set/model mutation claims,
- render/export effect verification,
- automatic runtime acceptance.

## Runtime status

`source_runtime_verified=false`

`host_ready_verified=false`

`production_ready=false`

Green CI validates source consistency only.

## Next source phase

The 100% milestone should close the bounded source scope with a canonical acceptance summary and an explicit real-Windows runtime acceptance handoff. Unsupported capabilities remain blocked rather than being added merely to reach 100%.
