# Adobe Substance 3D integration status

## Source milestone

Current declared source milestone: **40%**

The 40% milestone keeps the five-app desktop foundation and adds a documentation-backed, planning-only automation contract. It does not execute scripts, plugins, remote commands, project changes, rendering, or export.

## Suite scope

Shuvi continues to recognize Painter, Designer, Sampler, Stager and Modeler as Substance 3D desktop apps.

## Documented automation surfaces

Painter:
- Adobe documents Python and JavaScript APIs.
- Adobe documents remote scripting when Painter is launched with `--enable-remote-scripting`.
- Shuvi now exposes this as a planning-only surface; no remote command transport is implemented yet.

Designer:
- Adobe documents a Python API and Python plugin system.
- Shuvi can plan an in-app Python plugin workflow using an absolute `.py` or `.sdplugin` path.
- No external remote transport is claimed or implemented.

Sampler:
- Adobe documents a Python API, plugins and scripts.
- Adobe release/documentation material documents the `--run-script` command-line parameter.
- Shuvi can plan an absolute `.py` script launch, but does not execute it yet.

Stager and Modeler:
- no authoritative scripting surface was verified in the research used for this milestone,
- Shuvi therefore blocks automation planning for them instead of inferring an API.

## Implemented source scope

- bounded five-app Windows detection and exact launch,
- capability/readiness reports,
- documentation-backed automation surface catalog,
- bounded automation planner for Painter, Designer and Sampler,
- exact app/surface pair validation,
- bounded absolute script/plugin path validation where required,
- fail-closed Stager/Modeler planning,
- source safety and Rust unit tests.

## Execution boundary

All 40% automation plans report:

- `execution_supported=false`
- `mutation_performed=false`
- `source_runtime_verified=false`
- `production_ready=false`

No arbitrary Python/JavaScript payload is accepted or executed in this milestone.

## Runtime status

`source_runtime_verified=false`

`host_ready_verified=false`

`production_ready=false`

Green CI does not change these flags.

## Next source phase

The 60% milestone may add permission-first runtime adapters only for separately verified transport surfaces, beginning with Painter remote-scripting readiness and/or Sampler script launch. Designer plugin execution should remain separately guarded, and Stager/Modeler stay blocked until an authoritative scripting surface is verified.
