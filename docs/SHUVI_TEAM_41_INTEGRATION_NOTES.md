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


## Team-41 persistent authenticated session milestone (follow-up)

A new normal native owner-approval surface has been integrated into
\`src-tauri/src/lib.rs\`, not just sketched:

- \`blender_session_start\`: exact absolute installed Python/Blender executables,
  optional exact existing .blend, existing output directory and boolean render
  *ceiling*. High-risk explicit approval. Rust creates/registers the Python
  broker PID; the fixed broker launches Blender via the separate package's
  authenticated loopback bridge, obtains scene.inspect session UUID, then
  reports ready.
- \`blender_session_inspect\`: fresh authenticated read-only scene revision,
  same session UUID, managed root PID identity and Rust memory status.
- \`blender_session_plan\`: distinct high-risk approved action each time, exact
  UUID, <=6 typed PlanRunner operations, <=90 sec Python plan, <=120 sec
  native response budget, <=64 KiB input. No arbitrary Python, no destructive
  actions; action-level render flag must also fit the immutable launch ceiling.
  Success requires actual verified .blend/reopen or PNG artifact, Rust independent
  SHA-256 readback and canonical source action ID when present.
- \`blender_session_close\`: retire the exact owned launcher process tree after
  the closed/closing acknowledgment, not an unrelated Blender PID.

The session lifetime is bounded to **15 minutes** from launch and at most **48
commands**; all calls share the same one Python broker and authenticated Blender
client until retired. A session does not restart automatically after bridge
crash, bad response, expired session, failed plan, timeout or a process/resource
identity violation. Because a partially applied plan can have side effects,
the entire owned session is retired on such uncertainty before another plan
can execute. This is *not* replay-based resume or unattended autonomy.

The broker uses a private Rust-owned child stdin/stdout command pipe rather
than opening another unauthenticated localhost server. It implements a
bounded JSON-lines protocol with a UUID matched to the Blender inspection
response. Exactly four allowlisted operations exist (ping, inspect, run_plan,
close); unknown keys, script strings, arbitrary tools and implicit rendering
are prohibited. Authenticated Blender transport/session is provided by the
verified external source package and is **not** claimed as independently live
tested here.

### Precise shared-file overlap for later integration

- \`src-tauri/src/lib.rs\` gained **one** module declaration, **four**
  ToolAction enum variants, one \`ActionState\` session-registry field,
  four parse/approval arms, four audited dispatch arms, allowlisted typed tool
  names, and model-visible fixed tool guidance. Canonical action UUID and Rust
  native execution lease remain untouched. This overlaps other teams only in
  common type/parse/dispatch declarations; review these exact insertions during
  integration.
- \`src-tauri/tauri.conf.json\` adds
  \`blender-worker/shuvi_blender_session.py\` as a bundled fixed resource.
- \`src-tauri/src/blender_plan_worker.rs\` exposes only the pre-existing native
  artifact gate to the new typed worker (\`pub(crate)\`), preserving its behavior.
- New isolated Rust/Python modules:
  \`src-tauri/src/blender_session_worker.rs\` and
  \`integrations/blender-worker/shuvi_blender_session.py\`.
- Regression files: \`integrations/blender-worker/test_shuvi_blender_session.py\`
  and \`scripts/native-blender-session.test.mjs\`.

### Verification boundaries and known gaps

Fixture-based Python tests simulate a bridge, Blender client and plans only.
They can prove framing, reusable in-process controller identity, explicit render
policy, fail-closed behavior and no automatic replay. They cannot prove
actual GUI or headless Blender process reuse, 3D object outcomes, artwork quality
or artifact import into Premiere.

The 4 GB Rust memory check currently operates while a broker command is
pending, not as a guaranteed continuously running idle-session watchdog.
The 15-minute age limit is checked on commands, not via a true independent
idle reaper. On hard OS kill of Python the Blender grandchild could outlive the
broker if the OS does not terminate the complete owned tree; native Windows
job-object anchoring and disposable live host acceptance are still needed.
Do not call the current session subsystem **production hardened** or
Windows Live Verified.

No private Avantika Verse assets, customer data, paid APIs or unrelated
repositories are modified or used for tests. Main and other team branches
remain unchanged; PR #19 stays **DRAFT**, no integration or merge.
