# Shuvi 41 — Blender checkpoint reopen integrity gate

Base SHA: `99c9e58ef0e43139edfe2d6464f6411be47e1aa0`
Branch: `feature/shuvi41-blender-worker`
Owner: team-41. This branch is independent and must **not** be merged automatically.

## Functional behavior

For an **approved** `blender_run_plan` ending in `file.checkpoint`, the bundled fixed
Python plan adapter now reads a bounded scene signature **after the save** while
the authenticated writer Blender session is still alive, closes that session,
then launches a **different** owned, authenticated Blender instance with a default
read-only `SafetyPolicy()` and opens that exact saved `.blend` path.

Scene and up to 1,000 objects are inspected through the existing typed
`scene.inspect` and paged `objects.list` API. Signature includes stable
scene metadata and object names/types, transform, dimensions, visibility,
collections, materials, modifiers and bounded camera/light fields.
Session-scoped IDs and revision hashes are validated *within* each session,
but are deliberately not compared across launches. The stable digest is
SHA-256 of normalized JSON, and both sessions' digests and object counts must match.

The Python verifier **must** see the exact saved filepath in the new session.
`file.checkpoint` intentionally preserves the old active filepath on the
writer; the writer therefore does not assert it switched to the checkpoint.
After reopening, `read_output` rechecks the on-disk file hash so that the
verified output has not changed. Errors result in `outcome_unknown` and
`retry_automatically=false`; no save or render is silently replayed.

Rust `blender_plan_worker::verify_output` additionally rejects a saved BLEND
without an authenticated read-only reopen proof, missing SHA fingerprint or
invalid object count. PNG receipts must name a PNG and supply bounded RGBA8
dimensions; the existing source package still verifies PNG bytes and Rust
independently hashes the on-disk output. The native result includes the
Rust-supplied `source_action_id` when execution has an audited action ID,
and a `checkpoint_reopen` field; other workers must never invent these.

## Changes in shared wiring

- `src-tauri/tauri.conf.json`, `bundle.resources`: one extra bundled fixed
  Python helper `shuvi_blender_reopen.py`, beside the existing Blender adapter.
  No edits to `src-tauri/src/lib.rs`, `main`, `ui-dashboard` or other teams.
  This is a resource-map addition; check for collisions in an integration review.

- `src-tauri/src/blender_plan_worker.rs`: exclusively team-41 Blender native
  verification/output response fields. It does **not** replace Rust's
  permission, process identity, action UUID or execution-lease tracking.
- `integrations/blender-worker/shuvi_blender_plan.py`: uses the new helper in
  the existing permission-gated launcher; **no arbitrary model Python**.
- `scripts/blender-reopen-proof.test.mjs` and Python unittest fake-session
  fixtures run without any Blender/Windows/Desktop access.

## Boundaries and remaining work

- Verification is bounded to 1,000 objects and fully represented collections;
  larger/truncated scenes fail closed instead of being falsely certified.
- This is readback of exposed scene/objects, **not** a full deep mesh/texture
  equivalence proof, visual/aesthetic QA, proof of interactive GUI behavior,
  or Windows live acceptance. On real Blender, behavior remains **LIVE UNVERIFIED**.
- It does not create durable persistent Blender sessions, cross-action resume,
  professional scene authoring, a job scheduler, or Premiere imports.
- Python 3.11+, installed **separate** `shuvi_blender_agent` package and a
  real accessible Blender executable are still required. No external package
  or repository was modified.
- The existing native 120 s deadline / 4 GB watchdog also covers reopen.
  Large project save+reopen can exceed this bound and must fail closed;
  no automatic retry of partially completed mutations.
- Following milestones: process-owned persistent sessions with auth/consent
  boundaries; full output manifest schema with action lineage; explicit
  disposable Windows save/reopen/render acceptance.

## Test proof

- Local Python fixture suite: 7 tests, covers a different session ID with
  same persisted content, tampered object content, wrong file, save-copy
  source path, changed page, oversized/truncated scenes, read-only replay.
- Node source-test integration runs the fixture suite and statically checks
  Rust gates/resource bundling. These tests are source/fixture checks, **not
  live Blender tests**.
