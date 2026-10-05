# After Effects runtime acceptance

Status: **runtime unavailable on the current machine**. Existing Premiere/Media Encoder installations do not
establish After Effects availability. No Adobe update/install was attempted. No real host cases have completed.
`runtime_verified:false`, `production_ready:false`; declared ExtendScript source scope remains complete.

## Run safely on a prepared Windows machine

From a clean checkout, run `./scripts/run-after-effects-acceptance.ps1` for read-only discovery. It prints the exact
source SHA, trusted AE candidates, local Rust availability and optional media-probe presence. Multiple AE installs
require an explicit `-AfterFXPath`. No PATH-based AE search, dependency installation, or host launch occurs by default.

Real execution is explicit: `./scripts/run-after-effects-acceptance.ps1 -Run -Phase core`.
The runner requires an existing compatible trusted AfterFX install and Rust toolchain. Preserve/close user work first;
it refuses an already running AfterFX process. Enable Adobe's script file-write permission through its normal UI;
the harness never changes preferences or bypasses licence/setup prompts. Any mandatory host interaction is a blocker.

Each run creates a fresh `shuvi-ae-acceptance-<UUID>/acceptance.aep` under the existing temp directory (or an explicit
`-EvidenceRoot`). Fixture geometry is deterministic; runtime IDs/request IDs are discovered/fresh per step. Existing
projects/files are never overwritten. Bootstrap rejects any saved/nonempty project; `app.newProject()` preserves the
native save/cancel prompt even for an edited empty project. No undocumented `Project.dirty` dependency is used.

The test-only harness uses Shuvi's bundled adapter, typed `execute`, checkpoints and pending-job reconciliation.
Ordinary CI compiles it but ignores the real-host test. The wrapper invokes only the exact ignored test with
`SHUVI_AE_ACCEPTANCE=disposable-only`. The evidence ledger binds source SHA, fixture UUID, exact request IDs and receipts.
No runtime acceptance test is a production tool, and no alternate arbitrary JSX execution tool is exposed.

## Phases and evidence

| Phase | Prepared representative checks | Extra explicit input |
|---|---|---|
| `core` | IDs/revisions, static writes, keys, expression, effect, create/remove, parenting, mask, precompose, text/shape, supported camera/light/material/transforms/POI, sequential title recipe, numeric Essential controller/property, save/reopen, checkpoint/recovery planning, late receipt blocking/reconciliation | None |
| `render` | Exact owned queue item, deterministic marker-before-launch prevention, terminal reconciliation with retained marker, separate new request for DONE/output change/size, optional trusted ffprobe | `-OutputModuleTemplate` exact installed template name and `-OutputExtension mov/mp4/avi` |
| `cancel` | Fresh isolated render item and timed cooperative stop attempt, exact cancel ID, requested/observed/USER_STOPPED evidence, uncertain outcome retained | Same explicit render inputs |
| `preset` | Approved fixture copied into project trusted root, byte-verified runtime staging, checkpoint, isolated/restored selection, independent before/after inventories, save/reopen observed inventory comparison | `-PresetFile` explicit approved absolute regular `.ffx` |

Default output is only 320x180, 24 fps, one second. Template names are never guessed across locale/version. The
timed cancel case can complete too quickly or miss a native callback boundary; it records `not_exercised_or_uncertain`
and leaves during-render cancellation unverified. Before-start prevention never establishes that an active render stopped.

Every mutation refreshes context/revision, uses a unique request ID and receives a saved-file checkpoint. The core
budget preserves the existing 32-checkpoint retention limit. Pre-start render and delayed-read-only scenarios deliberately
reserve typed transport files before launch and label themselves acceptance-controlled wrappers; they do not bypass
production collision guards. The latter waits 2.5 s in the host wrapper and verifies durable unresolved blocking at 1 s,
then exact late receipt reconciliation, without retrying a mutation or killing AE.

Save/reopen first requires verified saved bytes, a fingerprint-verified checkpoint, exact active fixture path/revision
and unchanged size/modified time. Only that owned disposable project can be closed. Post-reopen property/keyframe/
transform/Essential observations establish persistence for those values; preset inventory equality establishes only
the observable subset. Checkpoints preserve saved file bytes, not unsaved in-memory edits. FNV is noncryptographic.

Reports distinguish request acceptance, reported mutation execution, host readback, separate inspection, saved-file
change, explicit post-reopen persistence, render completion, media metadata and visual review. Receipt acceptance never
sets semantic/persistence verification. Per-case evidence is retained; aggregate `runtime_verified` and
`production_ready` stay false for human review. Static/model/Windows compile evidence is recorded independently.

## Stop and preserve

Timeout, mismatch, rejected mutation, failed readback or unknown state stops the phase. Requests/receipts, cancel markers,
checkpoints, project and `acceptance-report.json` remain retained. A fixture lifecycle timeout also retains
`lifecycle.pending.json`. Never replay a timed-out phase against that fixture or delete its blocking evidence. Inspect
the exact host/project and reconcile the exact late receipt first. No automatic restore, cleanup or reopen of user work.

Pending real checks include visual review, broader version/renderer combinations, Essential media replacement with an
approved source asset, MOGRT interoperability/export acceptance, recovery by separately approved backup opening, and
optional decode/playback. No trusted media probe/decoder is installed here; structural metadata never proves playback.
Native detection/tracker APIs, general non-render abort and speculative UXP remain the existing documented boundaries.

Next test: existing compatible AE + file-write preference + clean checkout -> discovery -> one `core` disposable run.
Review its retained evidence before moving to the optional phases. This machine's unavailable state is not phase completion.

API references: [newProject/open](https://ae-scripting.docsforadobe.dev/general/application/),
[project save/close](https://ae-scripting.docsforadobe.dev/general/project/),
[scripting/file-write preference](https://ae-scripting.docsforadobe.dev/introduction/overview/).
