# Adobe Substance 3D integration status

## Source milestone

Current declared source milestone: **60%**

The 60% milestone keeps the documentation-backed automation contract and adds narrowly bounded, permission-first runtime adapters for Painter and Sampler. It still does not claim project automation readiness, host acceptance, verified command effects, or production readiness.

## Suite scope

Shuvi continues to recognize Painter, Designer, Sampler, Stager and Modeler as Substance 3D desktop apps.

## Painter runtime adapter

Adobe documents remote control for Painter when the application is launched with `--enable-remote-scripting`, with the example client using localhost port 60041.

Shuvi now provides:
- explicit-approval, exact-detected Painter launch with only `--enable-remote-scripting`,
- managed process registration,
- a separate preflight that requires the exact live Shuvi-managed PID and a fresh exact executable binding,
- a bounded TCP connectivity check to `127.0.0.1:60041`.

The preflight does **not** send JavaScript or Python. A reachable port is not treated as proof that the endpoint belongs to the expected Painter PID, so:
- `endpoint_process_ownership_verified=false`
- `remote_command_dispatch_supported=false`
- `host_ready_verified=false`

## Sampler runtime adapter

Adobe documents Python scripts and the `--run-script` command-line parameter.

Before a Sampler script can be launched, Shuvi:
- accepts only an absolute `.py` path,
- canonicalizes the file,
- limits it to 1 MiB,
- produces a SHA-256 fingerprint receipt,
- requires the launch request to provide that exact prior SHA-256,
- fingerprints the file again immediately before dispatch,
- requires explicit user approval,
- binds launch to the freshly detected Sampler executable.

The source adapter launches Sampler with `--run-script <canonical approved script>`. Dispatch is not treated as effect or completion proof:
- `script_effect_verified=false`
- `script_completion_verified=false`
- blind retry after uncertain dispatch is not allowed.

## Still blocked

Designer:
- Python API/plugin planning remains supported,
- plugin install/execution is not implemented at 60%.

Stager and Modeler:
- no authoritative scripting surface has been verified in this integration,
- automation stays blocked.

Also not claimed:
- Painter remote JavaScript/Python command dispatch,
- Painter endpoint-to-PID ownership proof,
- project/material/texture-set/model inspection,
- render/export completion,
- verified Sampler script effects,
- runtime acceptance.

## Runtime status

`source_runtime_verified=false`

`host_ready_verified=false`

`production_ready=false`

Green CI validates source consistency only.

## Next source phase

The 80% milestone should add bounded, typed Painter remote read-only command receipts and stronger completion/readback evidence for Sampler without inferring success from dispatch. Designer execution and Stager/Modeler scripting remain blocked unless separately verified.
