# Adobe Illustrator integration status

## Source milestone

Current declared source milestone: **100%**

Adobe Illustrator's declared **bounded source scope** is complete. This is a source-code milestone, not a claim that a real Illustrator installation has passed runtime acceptance.

## Implemented source scope

Desktop foundation:
- bounded Windows installation detection,
- exact detected Illustrator executable launch,
- managed-process tracking.

CEP + ExtendScript bridge:
- authenticated localhost bridge on `127.0.0.1:17365`,
- rotating pairing token,
- bounded request/result queue,
- explicit read-only and mutation allowlists,
- no arbitrary ExtendScript transport exposed to the Shuvi tool protocol.

Read-only inspection:
- active document identity/path/saved state,
- artboards,
- top-level layers,
- page items,
- selection,
- observational document/layer/item/selection signatures,
- fresh document identity recheck.

Guarded writes:
- layer rename,
- layer visibility,
- layer locked state,
- exact document/path/layer/value preconditions,
- saved local document required,
- local `.ai` checkpoint before mutation,
- exact host receipt validation,
- independent post-write readback,
- no blind retry after uncertain dispatch.

Checkpoint/recovery:
- byte-for-byte backup of the last-saved local `.ai`,
- source/backup fingerprints,
- sidecar evidence,
- read-only checkpoint verification,
- manual recovery handoff plan,
- no automatic restore,
- explicit statement that unsaved in-memory edits are not protected by the disk checkpoint.

Export:
- bounded current-document export preflight planning,
- exact saved-document identity and output path validation,
- overwrite disabled,
- required runtime evidence enumerated,
- **no export execution claimed**.

Canonical source summary:
- `illustrator_acceptance_summary`

## Intentionally unclaimed

The 100% source milestone does **not** claim:

- arbitrary ExtendScript execution,
- stable persistent IDs for arbitrary page items,
- layer create/delete/reorder,
- page-item mutation,
- path/text/appearance mutation,
- artboard mutation,
- save/Save As automation,
- automatic checkpoint restore,
- export execution,
- real-host runtime acceptance.

These exclusions are part of the declared scope rather than unfinished hidden capabilities.

## Runtime boundary

`source_runtime_verified=false`

`production_ready=false`

A successful source build and green CI do not change these flags.

The next phase is **real Windows Adobe Illustrator acceptance testing** on an installed host. Runtime verification must prove CEP pairing, ExtendScript readbacks, guarded layer writes, checkpoint workflow, uncertainty handling, and export-preflight assumptions before any production-ready claim.

## Progression complete

- 20% — desktop foundation
- 40% — authenticated read-only CEP + ExtendScript bridge
- 60% — layer/page-item/selection inspection + identity guards
- 80% — guarded layer metadata writes + checkpoint/readback
- 100% — canonical completion summary + recovery handoff + export preflight planning

Source milestone: **100% complete**

Runtime acceptance: **pending**
