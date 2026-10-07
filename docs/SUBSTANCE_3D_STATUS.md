# Adobe Substance 3D integration status

## Source milestone

Current declared source milestone: **20%**

This milestone establishes Shuvi's bounded Windows desktop foundation for the Adobe Substance 3D app family. It does not claim a supported host scripting transport, project inspection, material/model automation, rendering automation, or runtime acceptance.

## Suite scope

The foundation recognizes these app identities:

- Painter
- Designer
- Sampler
- Stager
- Modeler

Each detected candidate must live under a recognized Adobe Substance 3D Program Files folder and use the matching app executable name.

## Implemented source scope

- bounded Windows detection under standard `Program Files/Adobe` roots,
- recognition of the five Substance 3D desktop app identities,
- exact detected executable validation bound to the requested `app_id`,
- managed process registration after launch,
- capability report,
- readiness report,
- deterministic Rust unit tests,
- dedicated source safety CI.

## Automation boundary

`host_transport=not_implemented`

`future_host_transport=research_required`

No project, scene, graph, material, texture-set, mesh, model, render or asset automation API is claimed at 20%.

## Runtime status

`source_runtime_verified=false`

`host_ready_verified=false`

`production_ready=false`

Green CI does not change these flags.

## Next source phase

The 40% milestone should first research authoritative supported automation surfaces app-by-app. Only supported, verifiable interfaces should be added; no hidden or inferred host API should be invented.
