# Adobe Animate integration status

## Source milestone

Current declared source milestone: **100%**

Adobe Animate's declared **bounded source scope** is complete. This is a source-code milestone, not a claim that a real Animate installation has passed runtime acceptance.

## Implemented source scope

Desktop foundation:
- bounded Windows installation detection,
- exact detected Animate executable launch,
- managed-process tracking.

CEP + JSFL bridge:
- authenticated localhost bridge on `127.0.0.1:17364`,
- rotating pairing token,
- bounded request/result queue,
- explicit action allowlists,
- no arbitrary JSFL transport exposed to the Shuvi tool protocol.

Read-only inspection:
- active document identity and path,
- timeline/layers/current frame,
- library and symbol metadata,
- selected stage-element metadata,
- document and timeline signatures,
- bounded observational library/selection snapshots.

Guarded writes:
- layer rename,
- layer visibility,
- layer locked state,
- exact document/timeline/layer/property preconditions,
- separate high-risk approval,
- independent post-write readback,
- no blind retry after uncertain dispatch.

Checkpoint/recovery:
- byte-for-byte backup of the last-saved local `.fla`,
- source/backup fingerprints,
- sidecar evidence,
- read-only checkpoint verification,
- manual recovery handoff plan,
- no automatic restore,
- explicit statement that unsaved in-memory edits are not protected by the disk checkpoint.

Publish/export:
- bounded current-document publish preflight planning,
- exact document/timeline/path/output-directory validation,
- overwrite disabled,
- required runtime evidence enumerated,
- **no publish/export execution claimed**.

Canonical source summary:
- `animate_acceptance_summary`

## Intentionally unclaimed

The 100% source milestone does **not** claim:

- arbitrary JSFL execution,
- stable persistent IDs for arbitrary stage elements,
- layer create/delete/reorder,
- frame-content mutation,
- drawing/stage-content mutation,
- library/symbol mutation,
- ActionScript mutation,
- save/Save As automation,
- automatic checkpoint restore,
- publish/export execution,
- real-host runtime acceptance.

These exclusions are part of the declared scope rather than unfinished hidden capabilities.

## Runtime boundary

`source_runtime_verified=false`

`production_ready=false`

A successful source build and green CI do not change these flags.

The next phase is **real Windows Adobe Animate acceptance testing** on an installed host. Runtime verification must prove the CEP panel, JSFL readbacks, guarded layer write behavior, checkpoint workflow, and uncertainty handling before any production-ready claim.

## Progression complete

- 20% — desktop foundation
- 40% — authenticated read-only CEP + JSFL bridge
- 60% — library/symbol/selection inspection + identity guards
- 80% — guarded layer metadata writes + checkpoint/readback
- 100% — canonical completion summary + recovery handoff + publish/export preflight planning

Source milestone: **100% complete**

Runtime acceptance: **pending**
