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
- Subsequent milestones are persistent-session acceptance on an explicitly
  approved disposable Windows Blender host, robust visual QA and separate
  Adobe import authorization; the typed manifest described below is present.

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

An independent Rust watchdog probes OS process identity, current managed
memory, and the 15-minute lifetime every ~650 ms, even when the session is
idle or an approved plan owns the command mutex. It invalidates the session
before requesting termination on crash, stale identity, unknown memory
status, RAM-hard-limit breach or expiry; the next lock opportunity retires
the session. This is fail-closed rather than an automatic Blender reconnect.

Windows uses a kernel-owned Job Object with
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, assigned to the broker child by Rust.
Python must first receive an exact private `{"version":1,"op":"arm"}`
frame before it can launch the Blender grandchild. Rust only sends this
after it registers the OS process identity and successfully attaches the
broker to its Job Object. Failed assignment prevents the session entirely,
and closing the owned Job Object terminates associated descendants. The
native shutdown wait is capped at three seconds and a successful close
response requires an exact broker acknowledgement plus confirmed root exit.
Individual descendant exits are not claimed as separately observed.

`src-tauri/Cargo.toml` and `src-tauri/Cargo.lock` add only a direct
Windows-target dependency on the already locked `windows-sys 0.61.2`.
No Linux/macOS Job Object guarantee is claimed. Source CI, fixture tests
and Rust compilation do **not** prove live Blender behavior. Windows kernel
job containment, resource behavior and real project save/reopen/render
still require disposable, approved runtime acceptance. This is **not**
production hardened or Windows Live Verified.

No private Avantika Verse assets, customer data, paid APIs or unrelated
repositories are modified or used for tests. Main and other team branches
remain unchanged; PR #19 stays **DRAFT**, no integration or merge.


## Milestone — typed verified artifact handoff, no automatic import

`src-tauri/src/blender_artifact_manifest.rs` is a deterministic native
handoff constructor used by BOTH the legacy approved `blender_run_plan` and
persistent approved `blender_session_plan`. It does not perform any filesystem
writes, UI operations or uploads. Team-38 scheduler / team-40 Adobe workers
can consume the `artifact_manifest` field *after* explicit downstream
authorization; the artifact must be re-verified before later use.

Version-1 schema includes:

- `schema_version=1`, `producer="shuvi41.blender"`,
  `status="verified"`, mandatory **canonical native action UUID**,
  optional exact Blender session UUID.
- Canonical absolute output path inside the approved output directory,
  strict `BLEND|PNG` format, real file size and SHA-256; PNG color,
  bit depth and bounded dimensions when present.
- Evidence of independent native SHA-256 readback, typed step count,
  non-destructive policy, and **independently reopened** `.blend` scene
  fingerprint/object count where applicable.
- Explicit `requires_new_action_approval=true`,
  `import_performed=false`, `target_application=null`,
  `host_live_acceptance_proven=false`,
  `visual_quality_verified=false`.

Rust rejects missing/malformed action IDs, forged session IDs, stale file
SHA-256/size, outputs outside the approved directory, symbolic-link output
paths, untrusted/partial plan receipts, and missing reopen proof. The
native manifest is a **claim tied to fresh checked filesystem bytes when
created**, not proof of subsequent file immutability. Consumers MUST re-hash
the file before importing; a manifest alone is **not** permission to edit,
render, move files or operate Premiere/After Effects.

Four native unit tests exercise a real disposable filesystem fixture for
valid manifest construction, output tampering/escape, missing reopen
proof/invalid UUID, and untrusted/incomplete receipts. Frontend source tests
check both execution paths and explicitly disallow false import claims.
No real Blender executable or AntCloud instance was started to run them.

Review exact new module registration in `src-tauri/src/lib.rs` together
with the original shared ToolAction insertion before eventual integration.
Branch remains unmerged and runtime acceptance **LIVE UNVERIFIED**.

## Follow-up milestone: stale-scene protection and downstream byte revalidation

An independent `blender_session_inspect` returns `scene_revision`, a
64-character SHA-256 scene-state revision sourced from the authenticated
Blender adapter. For **each separately approved** `blender_session_plan`,
the caller must now supply an exact
`expected_scene_revision` copied from a fresh inspect. This field is
enforced in the Rust proposal parser, Rust session worker, bounded IPC
protocol, and the fixed Python broker. Python parses the entire typed plan,
then performs a new `scene.inspect` in that *same authenticated Blender
process* immediately before starting PlanRunner. If the scene has changed,
the broker returns `outcome_unknown` and safely retires the owned session
**without dispatching the plan**. No revised/widened expectation is silently
substituted, and no plan is retried automatically. Python fake-session tests
cover missing/malformed revisions and a stale preflight that never calls
PlanRunner. Session identity and the previously required action-level render
grant remain mandatory.

A separate **read-only** `blender_verify_artifact_manifest` native action
completes the receiving side of the team-41 output handoff. It accepts the
original typed manifest plus an explicit existing `approved_output_dir`.
The native verifier checks manifest structure, canonical action/session
UUID formats, exact parent directory and on-disk file, bounded size, SHA-256,
file extension and output-format-specific details. It rejects changed bytes,
unsafe filesystem paths, forged/malformed lineage identifiers, and manifests
falsely claiming that an import has already happened. The result intentionally
reports `status=file_bytes_reverified`, not `status=imported`, and marks
`source_action_approval_reverified=false`,
`original_blender_reopen_reexecuted=false`,
`import_performed=false`, and
`requires_new_action_approval=true`. Historical auth cannot be established
from untrusted JSON alone. Downstream scheduler/Adobe action must separately
check canonical audit history, seek specific user approval, and import only
through its own permission-gated tool after another safe path readback.

These features are implemented in source and source/unit tests, **not** yet
validated by actual Blender Windows model editing. Do not present source
fixtures, file integrity or native Job Object tests as live creative-work
acceptance.


## Current milestone — independently verified **mesh geometry** and safe acceptance recipes

Original checkpoint fingerprinting intentionally ignored session-local Blender
object IDs and revisions, but did not inspect the actual vertex/face topology.
This could give the same fingerprint to visibly different meshes if names,
bounding boxes and object metadata agreed. That is now fixed.

`shuvi_blender_reopen.capture_scene` uses the official package's
**read-only** `mesh.inspect` operation for each visible MESH object. It
hashes actual bounded vertex coordinates and indexed polygon faces,
validates each returned geometry revision, correlates the exact session-local
object ID/name, and re-inspects scene revision at the end so mixed
concurrent snapshots cannot be called verified. It compares writer and a
**different read-only process** opened on the saved .blend, using stable
SHA-256 geometry digests rather than process-local identities.

Conservative safety ceilings are **64 mesh objects**, 8,192 vertices and
8,192 faces across the inspected scene, max 4,096 per mesh and 1,000 total
objects. Larger projects are deliberately **not certified** by this gate,
rather than mistakenly receiving a positive claim. Native Rust BLEND
receipt verification now *requires* `mesh_geometry_verified=true`,
bounded mesh/vertex/face counts in the independent reopen proof, and the
versioned artifact manifest carries these values forward.
This is still bounded geometry proof, not byte-exact Blender scene
equivalence, shader graph / texture QA or artistic review.

`integrations/blender-worker/shuvi_blender_acceptance.py` adds a
**PLAN_ONLY_NO_BLENDER_LAUNCH** three-stage functional acceptance scenario.
It generates real, bounded declarative PlanRunner steps and bindings from
a caller's *fresh* inspected scene revision, with distinct command and request
UUIDs. It never launches an executable, alters a project, or calls an API.

- `model1`: create a five-vertex closed pyramid MESH, inspect it, edit
  its top vertex using fresh object/geometry revision bindings,
  re-inspect the scene and save `shuvi41-proof-stage1.blend`.
- `model2`: run in the **same approved persistent Blender session**,
  locate the exact named proof mesh, inspect/bind its session-local ID,
  edit the top vertex again, re-inspect and save a **different**
  `shuvi41-proof-stage2.blend`. This verifies session reuse and
  independent checkpoint persistence without overwriting stage1.
- `render`: start a **new, separately approved** Blender session by
  loading stage2's verified checkpoint, inspect the new scene, explicitly
  approve CPU rendering, configure 64x64 RGBA8 / one-sample render,
  re-inspect and produce `shuvi41-proof-render.png` with native SHA and
  structural PNG verification. A camera is necessary; no camera is invented
  or silently created if the saved scene lacks one.

Stage 1 and stage 2 must each be submitted as a separate owner-approved
`blender_session_plan` with the exact current `expected_scene_revision`
from `blender_session_inspect`. Stage 3 requires a new
`blender_session_start` with `allow_render=true`, another fresh
`blender_session_inspect`, and a separately approved render plan.
The original hard bounds (<=6 plan steps, <=90 seconds per plan,
<=120 seconds native action deadline, 15-minute session lifespan,
4 GiB policy, non-destructive) are unchanged. Output directory must
already exist, and output files must be new, never overwritten.

**No actual Blender process has been run** in this chat or in fixture
tests. The plan-only scenario requires an explicitly authorized disposable
Windows host for live acceptance. A plan being syntactically valid does not
prove Blender scene edits, project reopen, render quality, or system readiness.


## Team 41 continuation — Native three-stage acceptance receipt consistency gate

New \`src-tauri/src/blender_acceptance_chain.rs\` is a native, bounded,
**read-only evidence reviewer** exposed as
\`blender_review_acceptance_chain\` through ordinary native ToolAction parsing,
approval and dispatch (no new runtime process, no Blender launch). It expects
exactly three separately generated native \`blender_session_plan\` receipts
plus one pre-existing approved output directory. It does not accept an
unbounded catalog or inferred stage order.

To pass the gate all of the following must hold:

- Stage files are precisely \`shuvi41-proof-stage1.blend\`,
  \`shuvi41-proof-stage2.blend\` and \`shuvi41-proof-render.png\` inside
  the approved root. Existing \`artifact_manifest\` verification re-reads
  actual on-disk bytes and SHA-256 for *each* stage before comparing anything.
- Each native receipt has verified status and full-plan completion, an exact
  canonical action UUID, session UUID and a matching manifest. Distinct
  action IDs are required for each stage; the first two sessions must be the
  **same**, and the render session must be **different**.
- Both saved geometry stages require independent read-only reopen evidence,
  bounded mesh/vertex/face counters, different scene fingerprints **AND**
  different mesh-only topology fingerprints (stable name + exact vertex/face
  geometry digest). This prevents scene metadata or render changes from
  being mistaken for a successful modeling mutation.
  and saved file hashes. No render result is marked verified if its image
  metadata differs from 64×64 RGBA8.
- The returned \`status=receipt_chain_consistent\` means only *current file
  bytes and internally supplied receipt relationships are consistent*. It
  explicitly says \`historical_owner_approval_reauthenticated=false\`,
  \`render_source_stage2_binding_proven=false\`,
  \`live_blender_runtime_verified_by_this_review=false\`,
  \`visual_quality_verified=false\`, \`import_performed=false\`.
  Review must not be promoted to live runtime acceptance without original
  native audit lookup and independently confirmed stage2 input loading.

**Additional Rust file structure safety:** The native
\`blender_plan_worker::verify_output\` previously rehashed each saved file
without independently inspecting its signature. It now checks actual .blend
magic, pointer-size/endian flags and three version digits, and PNG's 8-byte
signature and IHDR width, height, RGBA8 color type and encoding fields
before accepting the matching file SHA. This detects wrong-header/mismatched
metadata files; it is not a full .blend or PNG decoder, and artifact SHA
alone never proves semantic model correctness.

Dedicated Rust unit tests use disposable synthetic .blend headers and a
real generated 64×64 transparent PNG to verify the native structural
reviewer's happy path, wrong session/action IDs, forged geometry hashes,
altered image bytes, swapped stage ordering and wrong approved root.
Node source tests verify typed routing and structural guard presence.

The review action does not import into Adobe, verify paid host state, create
new checkpoints or exercise real Blender. It leaves the user's existing
assets, other teams' branches and main untouched. Do not claim a real
end-to-end Blender acceptance test has been run from these fixtures.


## Source-checkpoint binding for separately approved render sessions

\`blender_session_start\` now accepts \`expected_blend_sha256\` alongside
an optional \`blend_file\`. Both fields must be either null or populated;
an arbitrary filename alone is insufficient. Rust verifies a bounded
regular, non-symlink .blend file, actual BLENDER header, canonical path,
length (≤128 MiB) and the **exact SHA-256** before owner approval and
again immediately before launching the owned broker. The broker only
launches after the existing Rust Job Object/arm handshake. The Python
broker re-hashes the source before launch; after the authenticated
\`scene.inspect\`, it checks the actual loaded \`scene.file\` path against
the approved source and re-hashes the source once more. A changed file,
wrong loaded scene, bad hash or unavailable file prevents startup.

The original Rust session records the canonical input checkpoint proof.
Every separately approved \`blender_session_plan\` rechecks the input on
disk before and after execution; it retires the owned session on uncertainty.
A verified plan receipt contains a native-controlled \`input_checkpoint\`
with path, SHA-256, byte count, \`verified_loaded_file_path=true\` and
\`loaded_file_hash_checked=true\` when a source was loaded, or null for
a new empty startup scene. These fields are *not* a replacement for
rechecking the file on a future run.

The read-only \`blender_review_acceptance_chain\` compares the third
stage's input receipt with the exact canonical Stage-2 output path, SHA
and byte count; missing or substituted input evidence is rejected even
when the render PNG itself has a correct hash. The returned verdict now
includes \`render_source_stage2_binding_consistent=true\`. The separate
\`render_source_stage2_binding_proven=false\` remains intentionally
false: a caller-provided receipt collection is not an authenticated
historical audit log. Full audit binding must independently correlate
persisted approved action IDs and runtime evidence. The validator
does not itself run Blender, mutate scenes or certify visual quality.

New regression tests include Rust SHA-readback/changed-source/header
cases, Python broker exact-loaded-path/changed-bytes denial, and native
three-stage reviewer rejecting missing source proof, swapped paths,
incorrect source SHA or byte length. This is source/CI verification only;
disposable real Windows Blender acceptance remains outstanding.


## Follow-up reliability fix — one-off plan input parity

The original \`blender_run_plan\` single-use helper previously accepted an
existing input \`.blend\` without a declared expected hash, while the owned
persistent session required \`expected_blend_sha256\`. This asymmetry is
now closed: both typed ToolActions require exact \`blend_file\` plus
\`expected_blend_sha256\` together, or both omitted/null. Rust validates a
bounded regular file, .blend header, canonical source path, actual bytes and
SHA-256 before any mutation dispatch. The one-off Rust worker uses the
same \`blender_input_checkpoint\` shared helper at action entry, passes a
fixed \`--expected-blend-sha256\` argument to the already bundled Python
helper, and rechecks current source bytes after the action completes.

The one-off Python script imports the fixed sibling broker's **read-only
\`inspect_input_source\` helper** (not arbitrary Python), checks the hash
before launch, confirms the exact loaded filename from an authenticated
\`scene.inspect\` response, and checks the original input digest after
the plan's verified output. Every one-off native response includes the
exact validated input proof (or \`null\` if no source was loaded).

This is an intentional source-compatibility change: callers that formerly
provided \`blend_file\` without the matching \`expected_blend_sha256\`
will receive an explicit validation error, rather than silently loading an
unknown version. No newly rendered output or existing project file is
overwritten. No user-controlled script execution is added.

The Node source CI now checks one-off/persistent parity and exact
pre-/post-launch/source evidence; Rust compilation and Python bridge
fixture tests remain source/CI evidence, not a live Windows Blender run.


## Milestone — pinned **real upstream PlanRunner** compatibility CI

A dedicated PR workflow \`.github/workflows/blender-upstream-contract-ci.yml\`
checks out the **public** standalone Blender Agent repository read-only at
exact reviewed commit
\`96b88c2513152f772399f247989ef602d5e0a7d7\`.
The workflow runs on isolated GitHub-hosted Ubuntu CI with Python 3.12,
\`PYTHONDONTWRITEBYTECODE=1\` and never launches Blender, touches Windows
desktops or sends model/API requests.

The new \`test_shuvi_blender_real_contract.py\` imports the *actual upstream*
\`Plan.from_dict\`, \`PlanRunner\`, \`Request\`, \`Result\`, \`Status\`,
\`CreateMesh\`, \`TranslateVertices\`, \`PageQuery\`, \`RenderConfig\`
and \`FileAction\`. The isolated fake controller serves only as a
deterministic in-memory object/mesh/scene executor so real production
Step/Binding/Request/Result contracts can execute **all three recipes**
from end to end. It proves the first model-created vertex moves,
the second plan reuses a session and changes the same vertex again,
both checkpoints carry different virtual mesh hashes, and the third
new-session plan configures/render-attempts a 64×64 image. It also checks
source parser validation, duplicate IDs, stale-scene refusal, no
automatic continuation after a failed first step, partial checkpoint failure
after an edit, stale mesh geometry injected between read and mutation, and
unknown-tool preflight rejection before any model operation.

This suite improves on a fake implementation of PlanRunner but must **not**
be described as real Blender runtime acceptance: there is still no bpy,
Blender executable, actual .blend save/reopen or rendered pixel verification.
Upstream source is pinned to guarantee deterministic CI results; its version
must be explicitly updated and the full contract suite rerun before
integration with a newer external Blender Agent commit.

## Milestone — local native audit-correlated three-stage receipt gate

The native entrypoint \`blender_review_acceptance_chain\` now performs a
**second verification layer after existing file/lineage checks**. Every
source action UUID from the three supplied receipts must resolve through
the existing \`read_action_audit_receipt\` into a persisted successful
\`executed\` event with tool \`blender_session_plan\`, the same UUID,
and an exact deterministic receipt suffix written when the original
native action succeeded.

For successful native \`blender_session_plan\` and \`blender_run_plan\`,
\`successful_execution_audit_detail\` records a compact
\`blender_action_receipt_v1\` suffix. It contains *digests* of output and
source paths, SHA-256 of verified output/source file bytes, exact sizes
and Blender session identity. For .blend checkpoints, the **independently
reopened real mesh topology SHA-256** and stable scene fingerprint are also
bound to the original successful action's native audit suffix. This prevents
later JSON edits from forging a mesh change while retaining an old valid file
hash. Raw filesystem paths are **not** inserted into the audit text. The reviewer reconstructs this suffix from each
verified receipt and requires an exact end-of-record match: a fake JSON
receipt that simply claims \`status=verified\` cannot bypass the local
audit lookup or change output/source hashes.

When **all three** native records, files, session constraints and saved
geometry checks agree, the outer reviewed result marks
\`local_native_audit_correlated=true\`,
\`historical_owner_approval_reauthenticated=true\` (against the local
Shuvi native executed-event log), and
\`render_source_stage2_binding_proven=true\` only **as a corroborated
local-audit / verified worker-receipt association**. It STILL returns
\`local_audit_cryptographically_tamper_proof=false\` and
\`live_blender_runtime_verified_by_this_review=false\`.
The pure read-only receipt-chain function without audit access remains
non-authoritative; its default historical-approval booleans stay false.

Audit log rotation, missing records, failure/denial events, different
tools, mismatching input SHA/byte count, wrong session, changed outputs
or legacy plan receipts from before the new audit suffix are **fail-closed**
and require a fresh approved acceptance run. Existing audit files are
not rewritten or backfilled. The action runs only after its *own* native
owner-approval path and does not grant any new desktop operation or
Adobe import permission. Local JSONL audit files are not externally
signed or immutable, so an adversary with filesystem write permission
may still tamper with them. Independent live host verification and
cryptographic attestation remain separate possible future milestones.


## Milestone — read-only authenticated persistent-session object discovery

Modeling commands previously required guessing object names or embedding
\`objects.list\` inside a plan whose final operation must checkpoint/render.
The new typed action \`blender_session_objects\` is read-only and is subject
to the canonical Shuvi proposal/owner-approval/audit path. It accepts
\`session_id\`, a fresh exact \`expected_scene_revision\` from
\`blender_session_inspect\`, \`offset\` (0..1000), \`limit\` (1..5),
optional \`name_prefix\` (at most 80 UTF-8 bytes) and optional
\`object_type\` (max 32 chars).

Rust checks the immutable session ID and all bounds. The existing private,
owned Python broker exposes ONLY a new allowlisted \`objects\` verb;
it constructs a fixed \`objects.list\` operation in the authenticated
Blender Agent transport, carrying \`expected_revision\`. The Python
broker verifies exact returned session/revision/offset/page length,
then sanitizes object readback to name/type/object_id/revision and the
\`details_truncated\` flag. Rust checks the same bounded response before
returning a \`status=read_only_object_page\` record. No scene mutation,
model-provider Python, code injection, file write or UI interaction occurs.

Object IDs are scoped to the current authenticated Blender session and
must not be reused across restarts/reopens. Scene mismatch, transport loss
or uncertain results retire the owned session, never silently continue
with an older object identity. Any follow-up mutation still requires a
fresh separately owner-approved \`blender_session_plan\` and its
scene-revision compare-and-swap; object discovery alone grants no edit.

Session fixtures cover happy-path pagination, exact allowlist/bounds,
rejection of unsupported extra command keys and stale-scene failure.
Source tests check native Rust parsing, broker IPC and the fixture suite.
No live Blender executable was launched during development.


## Current milestone — pinned real upstream PlanRunner and approved plan lineage

A dedicated GitHub Actions workflow, \`Blender Upstream Contract CI\`, checks
out the actual upstream \`shuvi-blender-agent\` at the **exact reviewed commit**
\`96b88c2513152f772399f247989ef602d5e0a7d7\` in an isolated subfolder.
Tests import that real repository's typed \`Plan.from_dict\`, \`PlanRunner\`,
\`CreateMesh\`, \`TranslateVertices\`, \`PageQuery\`, \`RenderConfig\`,
\`FileAction\`, \`Request\`, \`Result\` and \`Status\` implementations.
Only the bpy/Blender transport/controller is simulated. The test executes
both modeling-stage plans on one controller, compares the actual saved mesh
geometry after two vertex translations, then executes the render plan on
a new controller. It also tests stale revisions, invalid bindings, duplicate
command identities, and type/size limits. No Blender executable, renderer
or real customer project is launched by these tests.

New native \`src-tauri/src/blender_plan_lineage.rs\` now derives a canonical
SHA-256 of the **exact serialized owner-approved typed plan**, preserves
ordered operation names, bounded step count and classifies the known
stage-1 create/save, stage-2 edit/save and stage-3 bounded render recipes.
Unrecognized plans remain valid for ordinary authorized Blender use but are
marked \`acceptance_stage="other"\` and cannot claim one of the three test
stages. Stage classification requires the expected typed operations,
checkpoint names, render dimensions, geometry edit vector, and critical
live result bindings.

Both Rust Blender paths now attach \`approved_plan_lineage\` to successful
verified native results. The local executed-action audit appends a stable
\`blender_plan_sha256\` and \`blender_acceptance_stage\` token alongside
source/action/session/output identity and file SHA. The three-stage read-only
reviewer checks the typed stage identity, exact operation sequence and
agreement between native result step count and artifact-manifest verified
step count. Existing local executed-action audit lookup correlates the
supplied stage receipts with prior native successful actions. It remains
**local app-data provenance, not cryptographically signed remote execution
attestation**. No separate machine or actual Blender live application was
started. Real Windows Blender acceptance and visually inspected render
quality are still REQUIRED before calling this runtime-ready.

New regression tests cover stage classification, fake stages, wrong
operation sequences, stale metadata, absent plan hashes, and mismatched
step counts. CI must be evaluated against the exact latest commit;
previous pass states do not automatically carry forward.


## Extended native PNG render integrity gate

The saved PNG artifact is now independently inspected in Rust by
\`blender_png_integrity::validate\` after SHA-256/path/header verification.
It streams chunks in bounded buffers (≤32 MiB per chunk, ≤256 chunks,
≤128 MiB file), rechecks RGBA8 non-interlaced IHDR width/height,
calculates and compares PNG CRC-32 for **every** chunk, requires IDAT
data in a contiguous sequence, requires an exact IEND and rejects trailing
bytes. Unexpected critical and animated PNG control chunks are rejected.

The native unit tests write a structurally correct 64×64 RGBA8 PNG and
exercise corrupted IHDR CRC, corrupted image data CRC, wrong dimensions,
truncated IEND, trailing garbage and APNG controls. These cases are
not Blender pixel-render tests: the validator does **not** decompress
zlib/IDAT, examine displayed pixels, certify accurate 3D geometry in the
render, or assess creative quality. PNG structural validity cannot replace
the separately approved disposable Windows live acceptance.


## Team-41 continuation — native three-stage plan builder (no Blender launch)

The earlier acceptance recipe generator existed only as a standalone Python
CLI, meaning Shuvi's audited ToolAction workflow had no typed native entry
point to request it. The new **read-only**
\`blender_build_acceptance_recipe\` closes this functional usability gap.
Normal ToolAction parse/dispatch calls the new isolated native module
\`src-tauri/src/blender_acceptance_recipe.rs\`.

The caller supplies exactly \`stage: model1|model2|render\` and
\`expected_scene_revision\`, a fresh 64-character lowercase revision
returned by \`blender_session_inspect\`. Rust refuses unknown stage names
and malformed revisions. It returns a bounded, copyable **real upstream
PlanRunner-shaped** JSON plan with per-step unique canonical Request and
Command UUIDs, explicit typed payloads, and exact prior-result bindings.
All stages have immutable recipe operation sequences and outputs, so a
model cannot inject arbitrary Python, shell tools, or a seventh plan step.

- **model1**: construct five-vertex proof mesh, inspect geometry and bind
  the exact returned object identity and revisions; translate apex +0.25,
  inspect latest scene and save Stage-1 .blend.
- **model2**: inspect exact proof mesh in the *same* persistent session,
  reuse live object/geometry revision, translate apex +0.5, inspect again
  and save Stage-2 .blend without overwriting Stage-1.
- **render**: must use a *different owner-approved* Blender session opened
  with Stage-2's exact expected source SHA; configure 64×64 / 1-sample
  render, inspect latest scene and write a PNG artifact.

Crucially, every preview is classified and SHA-256 hashed by the **same
\`blender_plan_lineage::derive\` module** used when an approved Blender plan
actually runs. If this check says \`acceptance_stage=other\`, the recipe
builder refuses to provide a mislabeled acceptance plan. The preview
reports \`action_approved=false\`, \`blender_launch_performed=false\`,
\`plan_executed=false\`, \`output_artifact_created=false\`,
\`real_blender_runtime_verified=false\`. Its \`plan_preview_lineage\`
is a shape/digest hint **not an audit receipt**.

There is no automatic execution step. For each stage, the caller must
separately request \`blender_session_plan\` using the returned \`plan\`
and exact current session revision; native Rust user approval, render
policy, process ownership, SHA/mesh save-reopen proof, and audit checks
remain in force. Stage-3 also requires fresh
\`blender_session_start\` with \`allow_render=true\`, Stage-2 file path
and Stage-2 SHA, approved as an independent action.

Tests: new isolated Rust unit tests check stage classification, generated
UUID uniqueness across requests, upstream binding source/target paths,
invalid revision rejection, output filenames, render budgets and strictly
false execution/approval flags. New attested Node source contract checks
the four native wiring points, excludes arbitrary process/file execution
and runs the separate Python plan-only recipe as an independent operation
shape cross-check. The pre-existing pinned real upstream Python
PlanRunner contract workflow remains active.

**This is source implementation, not live Blender acceptance.** The
cross-worker audit corroboration layer and independent on-disk artifact
checks already built into Team 41 remain unchanged.


## Team-41 milestone — render-ready synthetic camera and key light (source / CI only)

Previously the three-stage proof implicitly depended on a pre-existing camera in
the startup scene, making an empty .blend checkpoint a known render blocker.
The source-owned fixed recipes now use real upstream `device.create` typed
operations to construct their own explicitly active camera and bounded point
light before Stage-3. **No Blender process was run** for this source milestone.

- **model1 (six steps):** create + verify the exact bounded five-vertex proof
  mesh, use the verified `mesh.create` readback's geometry revision to move
  the apex +0.25, inspect the fresh scene, create named active
  `Shuvi41ProofCamera` at fixed transform/lens/clip settings with a revision
  binding, inspect again, then save `shuvi41-proof-stage1.blend` using the
  *post-camera* scene revision. The separate mesh.inspect step was replaced
  with verified `mesh.create` geometry readback to stay within the existing
  six-step ceiling; Stage-2 still independently inspects the mesh and
  the checkpoint reopen worker still performs independent mesh topology proof.
- **model2 (six steps):** in the **same** separately approved persistent session
  create named `Shuvi41ProofKey` POINT lamp at fixed location, energy
  and color, using the just-inspected scene revision; page for the exact
  named MESH, inspect its session-local geometry, translate the apex +0.5,
  inspect the resulting scene, and save Stage-2 with that fresh revision.
- **render (three steps unchanged):** separately approved NEW session loads
  the *SHA-checked Stage-2 checkpoint*, configures 64×64 / one-sample CPU,
  inspects and renders to the bounded PNG. Stage-2 should now carry a camera,
  lamp and edited mesh. This is **source expectation**, not live proof that
  the resulting shot is visible or professionally lit.

The native read-only `blender_build_acceptance_recipe` still does not approve
or execute plans, and both modeling stages are recognized by
`blender_plan_lineage` only with their fixed typed operation sequences,
critical device settings and explicit revision/result bindings. Stage receipts
now require 6/6/3 executed steps. Existing permissions, action UUIDs, local
audit lookup, process watchdog, independent save/reopen mesh fingerprint,
on-disk SHA, PNG CRC, and three-stage evidence review are preserved.

Regression tests cover upstream actual PlanRunner and real
`CreateDevice.parse` typed contracts with a fake controller; camera/lamp
objects persist in a copied Stage-2 source, and deliberately missing camera,
failed device creation, substituted settings, or stale geometry cannot be
mistaken for verified end-to-end output. These tests have **no bpy / real
Blender launch**. They do not establish camera composition, realistic
lighting, decoded PNG pixel validity, GUI behavior, production readiness or
live Windows/AntCloud acceptance.

Changed modules remain team-41-owned. No new shared lib.rs ToolAction fields
were needed; the existing independently owner-approved
`blender_session_plan` is still the only executor. This change does NOT
authorize changing team 38/40 implementations, Adobe import, merge or deploy.

## Team-41 — independent saved camera/light readiness evidence (source-only)

The approved three-stage recipe now creates a camera and light, but merely
creating these objects is not proof that the active camera and illumination
survived into the reopened Stage-2 checkpoint. The existing authenticated
`shuvi_blender_reopen.capture_scene` now resolves the scene's session-local
`camera_id` through the complete, revision-consistent paged object readback
to a stable **active camera name**. That stable name is included in the
cross-process scene fingerprint; raw object/session IDs are still not compared
between different Blender launches. Missing or inconsistent active camera
identities fail closed.

For the exact Team-41 acceptance demonstration, the same readback explicitly
tests the fixed `Shuvi41ProofCamera` type, active identity, lens/clip settings,
bounded position/orientation, and render visibility; and the Stage-2
`Shuvi41ProofKey` light's type, color, intensity, position and visibility.
Numeric comparisons allow minimal native float roundoff. These narrow
checks create `proof_camera_verified` and `proof_key_light_verified` fields
only from inspected scene/objects data, not a model's description. Generic
unrelated Blender scenes may have these flags `false`: the general .blend
save/reopen worker does not silently require the sample camera/light.

The independently matched writer/reopen result passes the fixed role claims
through the existing version-1 artifact manifest; its downstream byte
reverification remains read-only and *does not* independently re-run Blender.
The three-stage native acceptance reviewer now denies Stage-1 or Stage-2
receipts missing the expected active proof camera, and Stage-2 receipts
without the fixed key light. Missing, false and wrong-name claims fail closed
even if PNG integrity and mesh topology otherwise agree. The review's
`active_camera_and_stage2_key_light_claims_consistent=true` refers only
to supplied, internally consistent reopen/source claims; it is **not**
photometric or semantic image verification, cryptographic attestation, a
guarantee that scene composition is useful, or fresh historical approval.

New fake-controller Python tests cover matching camera/lamp properties across
distinct session IDs, camera inactivity, wrong lamp energy and stale camera
identities. Native Rust and source Node regressions cover missing/wrong evidence,
with the original native mesh/scene hash, PNG CRC, local approval/audit,
file containment and independent source SHA requirements intact.
**No user project, Windows app, Blender executable, AntCloud host, merge,
deployment, Adobe worker or other team branch was run or changed.**

## Team-41 — standalone typed copper material look (source-only)

Optional `stage="look"` in the existing read-only
`blender_build_acceptance_recipe` generator produces a **standalone**
five-step plan: inspect scene, paginate for the exact named MESH with a
scene-revision binding, assign a new fixed Principled-style material using
the upstream typed `material.create_assign` operation and session-local
target identity plus expected object revision, inspect the post-material
scene, then checkpoint as `shuvi41-proof-material.blend` with a fresh
bound scene revision. This is plan-only, not an automatic operation, and
NOT part of the model1/model2/render three-stage acceptance chain.

Fixed material: `Shuvi41ProofCopper`, RGBA `[0.8,0.41,0.16,1.0]`,
metallic `0.65`, roughness `0.31`. The existing upstream
`MaterialAssign.parse` enforces color/scalar bounds, a uniquely named
editable mesh with unshared data, native readback and rollback on mismatch.
Native provenance recognizes only the exact step order, fixed parameters,
revision/target bindings and unique output name. Substitutions classify
the plan as `other`. The original three-stage reviewer still rejects
this supplemental look as evidence of model1/model2/render.

A **NEW explicitly owner-approved persistent Blender session** must
first load the Stage-2 `.blend` with its existing canonical-path, byte
length, SHA-256 and authenticated startup-load checks. The read-only
preview does not open or execute the plan; an independently approved
`blender_session_plan` action is required. The separate material file
is only created by actual successful execution, independently verified
save/reopen, and current-file integrity checks. No actual materialized
Blender output is claimed here.

The unchanged three-stage render intentionally uses its original Stage-2
checkpoint rather than the optional material artifact. A visually
verified materialized-render acceptance path needs a separately designed
workflow and host validation, not a fabricated receipt.

Source regression tests use the PINNED REAL upstream `Plan.from_dict`,
`MaterialAssign.parse` and `PlanRunner` with a fake deterministic
controller; they also cover stale or missing targets, failed checkpoint
delivery, native exact plan provenance, read-only CLI-only generation
and lack of implicit render/owner approval. This is NOT real bpy or
Windows/AntCloud execution. Existing three-stage tests remain intact.

## Team-41 — source-attested optional material render (source-only)

The existing fixed native **plan-only** recipe now recognizes the additional
stage `look_render` with the same bounded 3-step, 64x64, CPU, 1-sample
typed render sequence as the original `render`, but with a distinct
`shuvi41-proof-material-render.png` output. The original three-stage
`model1/model2/render` acceptance chain remains unchanged. This optional
render is **not** a fourth acceptance receipt, does not reuse its original
Stage-2 input and is never automatically approved.

**Required owner-approved runtime flow:** After a separately approved `look`
run successfully saves `shuvi41-proof-material.blend` with independent
read-only reopen proof and SHA-256 manifest, explicitly open a **new**
render-capable native owned session on the canonical material checkpoint with
its exact SHA-256, separately approve `look_render`, and supply the fresh
session scene revision. No input file or permission is implicitly selected
by the plan-only preview.

The authenticated Python broker adds a **read-only preflight before any
render.configure or render.execute** for this *exact optional output name*:
1. Revalidate the pinned source filename and the entire .blend SHA-256 bytes.
2. Match loaded scene file and caller revision to live authenticated inspection.
3. Demand exactly one untruncated named `Shuvi41ProofMesh` with one
   `Shuvi41ProofCopper` material slot and render visibility.
4. Resolve the fixed active proof camera by session-local ID plus independent
   transform/type/lens/clip/readback, and fixed key light type/color/energy/
   position/visibility, with revision-pinned object pages.
5. Re-inspect the scene after the pages; any changed revision, missing object,
   counterfeit material **name**, stale source or missing render permission
   stops before any mutation. Generic unrelated Blender plans are unchanged.

The upstream read-only object page exposes a **material slot name**, but
does *not* expose all shader node parameter values. Therefore this preflight
checks an independently saved named material slot, **not** a full independent
Principled BSDF color/metallic/roughness shader attestation. Existing look
assignment reports those parameters at mutation time. The png integrity
and source hash guards verify structural files, not appearance or image
quality. No render was executed on live Windows/Blender/AntCloud.

New tests prove real upstream `PlanRunner` can consume this bounded
look-to-look_render source plan against a deterministic fake controller;
separate read-only broker tests cover malicious SHA/source changes, missing
or extra material slots, stale revisions, inactive camera, wrong lamp,
ambiguous pages and no render approval. The original Stage-2 3-stage
receipt chain remains isolated. The material-render job must not be
counted as ordinary three-stage acceptance or real host verification.

## Team-41 — exact full-plan shape classifier and corrected material source (source-only)

Review found two defects in the prior source-only acceptance path:

1. Optional `look_render` preview erroneously set
   `requires_new_session_loading_verified_stage2=true`, although its source
   must be the SHA-pinned material checkpoint. The preview now makes the
   two mutually exclusive source requirements explicit:
   `render` and `look` load Stage-2; `look_render` loads the material
   checkpoint, *not* Stage-2.
2. The native `blender_plan_lineage::valid_stage` originally checked key
   identifying fields but did not compare every geometry coordinate,
   request timeout, complete result binding or extra payload key. A
   maliciously modified typed plan could still be labeled a fixed acceptance
   stage while its full plan SHA-256 reflected different actions.

The lineage classifier now has a second independent **complete JSON shape**
check against `blender_acceptance_recipe::expected_plan`, which is purely
declarative, does not invoke `derive`, and cannot launch Blender. Only canonical
distinct UUID request/command identifiers and the permitted *first* fresh
64-character scene revision vary. Every step operation, step name, bindings,
payload nested fields, geometry, target identity, requested material values,
render settings, plan/step deadlines and additional keys must otherwise
match. If there is any extra hidden field or swapped binding, lineage's
`acceptance_stage` is `other`. Original owner permissions and plan-SHA
audit remain in force; this stage classification still **does not prove**
historical approval, runtime execution or image quality.

Native Rust regressions cover all five recipes, forged geometry, extra
payload keys/bindings, timeouts, altered material targets, duplicate UUIDs
and distinct material-render destination, while source Node checks guard
the exact-template and preview-source contract. This requires no new
Blender installation, Python launch, GUI interaction or Adobe integration.

## Team-41 — native reserved-output dispatch policy (source-only)

A read-only native gate now prevents accidental or forged reuse of the
five fixed proof artifact names by a generic typed plan. Before dispatch,
`blender_plan_lineage::reserved_output_policy` examines every
`file.checkpoint`/`render.execute` output, not just the last step.
If any output is a fixed Shuvi-41 proof name, the supplied plan must match
the **entire exact native generated recipe** and the associated fixed role.
Duplicate reserved outputs, hidden steps or extra changes are refused.

When the fixed role is `render` or `look`, the selected SHA-verified
startup input file must be named `shuvi41-proof-stage2.blend`. When the role
is `look_render`, its SHA-verified source must be the distinct
`shuvi41-proof-material.blend`. Approval for rendering remains explicit
and separate. More importantly, `look_render` is denied in the one-off
Blender launcher altogether, because only the persistent broker has the
live saved-material-slot + camera + light preflight prior to rendering.
This prevents a one-off native route from silently omitting that check.
Ordinary unrelated plans and their filenames keep their normal native
permissions and are not forced into the example recipe.

Both persistent-session and one-off native execution paths evaluate the
gate **before contacting the Python/Blender process**. Source-byte checks,
owner approval, process ownership and independent artifact readback remain
additional guards; a matching filename by itself proves nothing about a
user project, successful Blender rendering or visual appearance.

New Rust and Node tests cover all five reserved outputs, arbitrary
unreserved plans, changed first steps/extra fields, absent or wrong
source name, missing render permission and one-off bypass attempts.
No actual app was launched or file in the user workspace changed.

## Team-41 — material render source-evidence delivery (source-only)

A new bounded **material-render preflight receipt** is assembled by the
authenticated persistent Python broker *only after* its read-only inspection
has verified the SHA-pinned material scene, named mesh/material slot, fixed
active proof camera, fixed point light and stable scene revision. The receipt
contains its session ID, source canonical path, SHA-256, byte count and
pre-mutation scene revision, plus explicit `false` for independently
verified shader parameters, completed render and approval reauthentication.

The broker returns this receipt only alongside a separately completed,
verified PNG PlanRunner output, never before render execution. The native
persistent worker checks the receipt against the Rust-owned original source
SHA/path/bytes, session UUID and caller's original scene revision. Wrong
source, cross-session replay, or a material proof injected into an unrelated
typed plan is rejected.

The existing native typed artifact manifest now carries
`evidence.material_render_source` only for the exact material-render PNG.
Its constructor re-opens and re-hashes the actual **source .blend bytes**
at delivery and rechecks the exact proof object/material/camera/light names
while preserving the existing output PNG SHA-256 and structure verification.
An absent material source receipt rejects materialized PNG delivery.
Non-material artifacts cannot attach this evidence.

Later `blender_verify_artifact_manifest` calls rehash the **current output
file**, validate that the historical source record has well-formed,
conservative fields and return flags explicitly stating
`material_source_current_bytes_reverified=false` and
`material_source_preflight_reexecuted=false`: the downstream review must
not read an arbitrary source path merely because a user-supplied JSON
manifest names it, or claim approval/image quality from historical evidence.

Rust source tests reject wrong SHA, altered source bytes, wrong device name,
missing session ID, exaggerated shader/approval claims, and material
evidence on unrelated PNGs. Python tests prove exact source fields and
read-only semantics; Node contract tests guard both native and broker wiring.
**This is source-only testing, not a real Blender render.** Approval,
Windows ownership, three-stage acceptance and old artifacts are unchanged.

## Team-41 — end-to-end exact output destination proof

Another real gap was discovered after the material delivery gate: an
otherwise well-formed, SHA-256-matching output inside the explicitly
approved directory was not independently compared with the **exact filename
of the last approved typed PlanRunner step**.

Both Python execution adapters (persistent and one-off) now refuse a
completed plan if the actual canonical output basename differs from
`final_step.request.payload.name`, if its extension is inappropriate,
or if the name is nested/invalid. The original output-root and independent
artifact SHA checks remain. The native Rust worker additionally
rechecks the actual worker artifact filename, format and (when present)
final operation against the *approved* typed plan **before** building any
consumable artifact manifest. This is a separate check from plan lineage,
file-byte verification, output-root containment, source-file SHA and
owner approval. A correctly hashed but wrong-named file is not a verified
delivery; never automatically replay a partially mutated plan.

New Python fake-runner tests reject mismatched, nested and wrong-extension
file outputs in the two execution modes. New Rust tests reject wrong
filename, switched BLEND/PNG type, contradictory final-operation claims
and Windows-style separator bypasses. Source Node checks make sure both
runtime paths have independent output-name proofs. This does not prove
actual Blender editing, rendering quality or host acceptance.

Previous Rust CI on commit `16aa4f9` found two cross-platform test
fixture errors in the new material-source evidence tests: Linux-only
absolute paths and an uncanonicalized temp path on Windows. The material
SHA/path production gate remains strict; the regression fixtures now use
canonical source paths and platform-native absolute temporary paths.
No real host data or live Blender/Adobe processes are involved.

## Team-41 — independently reopened Copper Look checkpoint (source only)

The `look` optional material step no longer rests solely on the upstream
`material.create_assign` success receipt or a generic independently reopened
scene hash. After saving `shuvi41-proof-material.blend`, both the writer and
a **different authenticated read-only Blender reopen session** now traverse
the bounded full object pages and mesh topology. The supplementary copper
proof is true only if there is **exactly one** named `Shuvi41ProofMesh` MESH,
with precisely one saved material slot named `Shuvi41ProofCopper`,
render visibility enabled and at least five vertices and five faces. Its
writer and reader scene/geometry fingerprints must match. The reopened
look checkpoint must also contain the exact active `Shuvi41ProofCamera`
and `Shuvi41ProofKey` verified by their concrete transforms and native
device properties.

A new read-only persisted-material flag is included in the reopen
receipt. Native `blender_plan_worker::verify_output` and the manifest
builder **deny delivery** of this specific look checkpoint if the
reopen receipt is missing copper-slot/camera/light evidence, or falsely
claims all shader node parameters were independently verified.
Downstream `blender_verify_artifact_manifest` checks the current file
bytes and validates that the historical proof is conservative; it explicitly
states it has **not run Blender reopen again**.

Other normal Blender model stages and unrelated user materials are **not**
forced to use the example Copper names. This is a named supplementary
look proof, not a replacement or added fourth stage in the original
`model1/model2/render` acceptance chain. Material **slot presence** is
verified independently, but Principled BSDF metallic/roughness/base-color
shader node values still are not independently read from upstream pages;
keep that distinction in the owner-facing UI.

Python fake-backed checks reject missing/wrong/duplicated material slots,
hidden objects, mismatched camera/light and changed reopened mesh state.
Native Rust tests prove the same fail-closed policy survives manifest
creation/reverification and that ordinary old .blend artifacts remain
compatible. There is **no live Blender run or user-workspace mutation**.

## Team-41 — complete typed-step transcript at both native handoffs

Before either a persistent or one-off Python worker emits `verified`,
the result of the actual pinned-upstream `PlanRunner` is checked against
**all** approved step names: exactly the same number and names, no duplicates,
no unknown extra results, no unexecuted steps, and every result status
`SUCCEEDED` or `VERIFIED`. A verified final PNG/.blend alone is not
proof that earlier approved steps ran. The independent final step still
must be `VERIFIED`, and the file must pass existing path/hash/reopen checks.

Python now reports `executed_steps` from this verified transcript and
returns the exact `final_operation` even for persistent sessions. The
native `verify_final_artifact_binding` gate refuses absent or mismatched
`executed_steps`, missing or substituted `final_operation`, wrong filename,
or wrong output format **before** a handoff manifest is built. The
original permissions, native audit plan digest, source SHA, artifact CRC
and geometry/camera/material persistence proofs remain separate guards.

New Python/Rust fixture tests cover false completed flags, skipped early
steps, forged step names, duplicate names, unexpected results, unexecuted
steps, failed statuses, missing operation and manipulated counts. These
tests use fake controllers/receipts; they are not real Windows Blender
acceptance or visual quality evidence. No other team's branch changed.

## Team-41 — useful bounded live Blender Object Details (source / read-only)

The existing owner-approved `blender_session_objects` surface now returns
more than an object's name/ID and scene revision. A successful authenticated
`objects.list` page may include a strictly bounded **read-only** view of
the object's position, rotation, scale, dimensions, render/viewport
visibility, material-slot names (including genuinely empty slots),
modifier name/type/render visibility and type-specific camera or light
parameters. This helps Shuvi ground modeling edits, material decisions and
scene navigation on observed data rather than inventing what is in Blender.

Only existing typed read-only upstream operations are used. The broker
projects rather than forwarding arbitrary raw upstream fields; it limits
each object to 16 material slots and 16 modifiers and finite numeric
vectors, rejects missing/ambiguous counts, malformed field types and
unbounded camera/light values. Oversized or legitimately truncated upstream
objects return `details_available=false` with a truncation indicator,
not a fabricated full inspection. Legacy minimal synthetic pages return
`details_available=false` and remain compatible with older callers.

Rust independently checks all projected typed fields, session identity,
revision, numeric bounds and **explicit false** flags for
`shader_nodes_inspected` and `mesh_topology_inspected` before
releasing a read-only page. It does not claim Principled BSDF parameter
values, real mesh topology, absolute world-space matrices or image quality.
The existing mutation gates and audit remain unchanged. No new native
tool/action is created, no file changes or Blender launches are required
for the source/fixture tests. A production Windows Blender host is still
necessary for actual visual acceptance.

Python fake-controller tests cover valid material/name/transform/modifier
and camera/light projections, partial payload rejection, wrong counts,
oversized detail lists, non-finite values and legacy/truncated readback.
Rust unit tests mirror positive and negative security cases; Node source
tests check that the broker projection is actually returned by the
existing persistent-session object endpoint.

## Team-41 — bounded read-only actual mesh topology in Object Discovery

The existing `blender_session_objects` operation now reads actual mesh
vertex coordinates and polygon index lists for a small, bounded subset
of real Blender MESH objects in the same owner-approved persistent session.
It uses the pinned upstream **read-only typed `mesh.inspect`**, without
adding a new model tool, mutation capability, launch, approval bypass or
arbitrary Python. This is intended for practical geometry awareness before
a separate explicitly approved modeling/editing plan.

When an upstream object has complete bounded detail fields, its live
`mesh.inspect` result must be tied to the same object ID/name. For up to
128 vertices, 128 polygons and 512 total polygon indices, the broker
validates all finite coordinates, face index bounds, duplicate indices
and the upstream geometry revision against the actual canonical JSON
SHA-256 of complete vertices/faces. It returns these arrays, counts and
digest with `mesh_topology_inspected=true`. It rechecks the Blender scene
revision after the additional read-only calls so mixed-state object pages
fail closed and the owned session is retired on uncertainty.

For larger meshes the new response explicitly says
`geometry_available=false`, `geometry_truncated=true` and
`mesh_topology_inspected=false`: it does not manufacture partial
coordinates or a trusted geometry digest. Legacy minimal synthetic pages
remain available without invented detail proof. Rust separately checks
the geometry bounds, all array lengths, finite values and every polygon
vertex reference. The digest verification is performed in the
authenticated broker; the native response conservatively declares
`native_digest_recomputed=false` (not a second byte-level digest proof).
No source data is modified, and permission checks remain unchanged.

Python fake-controller regressions include complete genuine small-mesh
geometry, wrong identity, SHA mismatch, malformed/non-finite vertices,
invalid face indices, large-truncated meshes, end-to-end same-broker
object-page delivery and mid-inspection scene revision changes.
Rust tests independently exercise structure and false evidence claims.
These source-only CI tests **do not** prove host Blender behavior or
professional geometry outcomes until live acceptance is authorized.

## Team-41 — bounded medium-mesh compact geometry summaries (source only)

The prior read-only `blender_session_objects` addition returned all
vertices/faces for small meshes only (at most 128 vertices, 128 faces,
512 polygon indices). Medium meshes previously returned no actionable
geometry evidence. This milestone adds a **separate, compact read-only**
overview for meshes within **1,024 vertices, 1,024 faces and 4,096 indices**
using the existing pinned, authenticated upstream `mesh.inspect` operation.
No new native action, user permission, disk write or arbitrary script is
introduced. The source controller is never replaced.

The Python broker validates **every** upstream vertex, finite coordinate,
polygon reference, non-duplicate index and the complete upstream geometry
revision against a locally recomputed canonical SHA-256. It only emits
bounded vertex/face counts, polygon index count, axis-aligned local
geometry minimum/maximum, source geometry SHA and conservative flags.
**Medium-mesh vertex and face arrays are not returned**. Thus an otherwise
large scene cannot create an enormous native model-visible JSON reply.
`mesh_topology_inspected=false` and `geometry_available=false` continue
to distinguish compact overview from full transferred geometry; the
new `mesh_overview_available=true` indicates a validated summary.
The downstream Rust gate separately checks scalar bounds, digest
format, count consistency and truthful no-native-rehash/no-arrays claims.

Meshes over the 1,024/1,024/4,096 budget remain
`geometry_truncated=true`, `mesh_overview_available=false` with
no invented digest or bounds. The broker checks that the scene revision
has not changed during either full small-mesh or medium-mesh multi-step
inspection before returning the page. Read-only calls still consume
bounded session command capacity and time. Upstream `mesh.inspect`
itself has a fixed 4,096-vertex/4,096-face cap, so meshes above that
may fail closed instead of returning even counts; a separate approved
paginated topology contract would be necessary for much larger meshes.

New Python fixtures cover 200-vertex mesh digest, counts, local bounds,
tampered/NaN/out-of-range elements, broken face indices, oversized meshes
and integration with authenticated object pages. New native Rust tests
reject forged geometry counts/bounds, mislabeled digest verification,
claims of transferred arrays and inconsistent legacy statuses.
These are source/CI checks; actual Blender scene/modeling acceptance
remains unverified until an owner-approved disposable Windows test.

## Team-41 — authentic large-mesh counts beyond upstream geometry cap

Read-only `blender_session_objects` now recognizes the upstream
`objects.list` mesh `data` snapshot, which exposes observed vertex,
polygon and edge **counts**, even for highly detailed meshes. The broker
validates the integer fields and identifies their provenance separately
from topology hashes. If the mesh has more than 4096 vertices or 4096
polygons — the pinned upstream `mesh.inspect` hard limit — Shuvi
does not dispatch that doomed, resource-intensive request. Instead it
returns source-observed counts with
`mesh_counts_available=true`, `mesh_topology_inspected=false`,
`mesh_inspection_skipped=upstream_geometry_limit`; it **does not**
invent a geometry digest, bounding box or full topology. Truly empty or
degenerate mesh shapes use a separate skip reason.

For meshes within 4096 vertices and polygons, the existing authenticated
typed `mesh.inspect` reads and validates every vertex/face, within
the upstream 32768-polygon-loop budget. Small meshes still return full
arrays, and larger inspected meshes return only a compact summary of
counts, local-space bounds and geometry SHA-256. If upstream count
metadata is present, its vertex/face counts must match the actual
inspected arrays. The existing final scene-revision check now also
covers the counts-only case.

Native Rust independently verifies count provenance, honest
`topology_verified_by_counts=false`, integer ranges, the precise
reason to skip `mesh.inspect`, and agreement between metadata and
the full or compact geometry proof for in-range meshes. Count-only
fallback must never claim a verified topology hash. The feature
does not circumvent upstream response-size protections; some dense
in-range meshes may still fail closed if the pinned upstream refuses
the read-only request.

New Python and Rust regression tests cover large counts-only meshes
without a `mesh.inspect` command, empty mesh reasons, invalid counts,
metadata/geometry mismatches, 1200-vertex compact inspection and
an end-to-end authenticated object-page query. These are
source/fixture validations rather than real Blender host acceptance.

## Shuvi 41 — Native independently rehashed geometry + strict object-page replay guards

The persistent, owner-approved read-only Blender object query is
now covered by two independent structural and integrity layers.

**Independent binary geometry commitment (small complete meshes).**
The pinned upstream `mesh.inspect` still emits its own canonical-JSON
`geometry_revision` that the Python broker compares against all actual
received vertices/faces. In addition, the broker now hashes those
same validated values using a versioned, language-independent
binary representation: `SHUVI41-MESH-NATIVE-V1 + NUL`, u32-big-endian
vertex count, each finite float64-big-endian coordinate, u32-big-endian
face count, then u32-big-endian polygon sizes and indices. The broker
includes the resulting SHA-256 commitment but declares
`native_binary_commitment_recomputed=false`.
Native Rust rejects the small topology if this fingerprint does not
equal its own independently recomputed binary64/u32 SHA. **Only after**
native verification does Rust set the response-specific
`native_binary_commitment_recomputed=true`. The pre-existing
`native_digest_recomputed=false` still truthfully refers to the
upstream JSON-specific geometry revision; it must not be confused
with this new binary commitment. For medium summaries and large
counts-only meshes no arrays are transmitted, so no native independent
vertex/face hash is claimed. No shader proof is inferred.

**Exact object-page proof.** Before the broker runs even the first
secondary `mesh.inspect` it checks exact page item count, offset,
total, next-offset cursor, unique session-bound object IDs, lowercase
object revisions, requested name prefix and requested object type.
Rust independently revalidates the same fields before publishing
the page to Shuvi planning. A malformed or repeated object,
inconsistent continuation or wrong filtered object fails closed,
invalidates the owned session and never becomes a verified read-only
observation. Normal empty/end pages and multi-page filtered queries
remain supported; no mutation or automatic retry is introduced.

The Rust CI regression identified in HEAD `b6ed996` was an obsolete
fixture expecting 5,000 face indices to exceed the previous 4,096
limit, although the new upstream-compatible bound is 32,768.
The test now uses 32,769 as a genuinely invalid count without weakening
the production bound. New Python tests exercise stale/duplicate/filter
rejection before secondary mesh work and commitment sensitivity; native
Rust tests exercise forged cursors, duplicate objects and tampered
coordinates/indices independently. This milestone is code and CI
validation only, not a real Windows Blender host acceptance.

## Shuvi 41 — bounded multi-object inspection fanout and honest time budget

A read-only `blender_session_objects` call previously reused the
15-second native `PROBE_DEADLINE` of simple ping/scene probes.
A page of up to five real MESH objects can require up to seven
authenticated read-only operations: one `objects.list`, five
`mesh.inspect` probes and one final `scene.inspect`, each with a
10-second typed upstream timeout. This could retire an otherwise
healthy owned Blender session before the inspected page completed.

The broker now permits at most **two** resource-intensive
`mesh.inspect` operations per object-page command
(`MAX_TOPOLOGY_READS_PER_PAGE=2`). The other eligible MESH entries
still return their real object transform/material/visibility details
and authenticated vertex/polygon/edge counts, if available, but
explicitly report `mesh_inspection_skipped=page_work_budget`,
`geometry_available=false` and **no** invented topology SHA or
vertex/face arrays. Objects with counts that already exceed upstream
4096 limits continue using their pre-existing counts-only fallback
without spending either mesh-inspection slot.

Native `blender_session_objects` now has its own strict 50-second
overall deadline; regular ping/inspect keep their original
15-second deadline. One bounded page therefore performs at most
one upstream page, two mesh reads, and one scene-revision
reconfirmation, with 10-second per-operation timeouts. A hang,
changed scene or invalid return still retires only the exact owned
session, with no blind retry or approval escalation. This is a
fixed, read-only observation budget, not an authorization to work
for 50 seconds without user permissions.

Rust independently accepts the `page_work_budget` truncation
only when it carries no geometry claims and consistently reported
authenticated counts (or explicitly unavailable counts). New
Python source-backed tests cover five mesh objects, exactly two
mesh.inspect calls, honest skip flags, no invented missing counts,
and preserved session ownership. Rust tests cover false full-geometry
claims on skipped objects. This improves practical host
responsiveness but is not real Windows Blender acceptance evidence.

## Shuvi 41 — broker/native JSON-line frame boundary

The authenticated persistent Python broker emits one newline-delimited JSON
response. Native Rust refuses to buffer a body at or above 131,072 bytes.
A broker response exactly 131,072 bytes was incorrectly permitted by its
old `>131072` guard, then rejected by the native framing reader when the
newline arrived. The broker now rejects a JSON **body >=131072 bytes**
before writing anything; the longest accepted body is 131,071 bytes, with
one trailing newline. A fixture regression exercises both adjacent
boundaries without launching Blender. No permissions or actual file
operations were altered.

## Team-41 — Independent persisted copper shader inspection before still render

The pinned upstream Blender agent actually exposes a **typed read-only**
`material.shader_inspect` operation. This resolves a gap noted in the
earlier source-only material-still contract: merely finding a material
slot called `Shuvi41ProofCopper` did not prove its shader properties.

The optional `look_render` persistent broker preflight now reads that
exact named material from the SHA-pinned `shuvi41-proof-material.blend`
source scene and independently checks its actual Principled BSDF node.
The base color must be approximately `[0.8,0.41,0.16,1.0]`,
metallic `0.65` and roughness `0.31` (within 0.002 to account for
Blender float32 sockets); the shader must have exactly one Principled
node, bounded node/link counts, and **no external links overriding
those fixed inputs**. The Python broker rehashes the entire
`material.shader_inspect` snapshot excluding the supplied
`shader_revision` field with the pinned upstream canonical JSON SHA,
and compares the independently calculated revision. The subsequent
`scene.inspect` still confirms the original session/scene revision.

A successful material-still preflight now contains
`shader_parameters_independently_verified=true`,
`shader_node_graph_revision_verified=true` and the shader SHA-256.
Native Rust checks all of these fields against its action/source/session
receipt and stores the historical shader graph revision in the
material PNG manifest, preserving the independent approved .blend
source-file SHA-256 check. Historical manifest reviews verify that
conservative typed receipt but explicitly do **not** re-run Blender or
claim current shader freshness. The earlier *look checkpoint* reopen
still proves a persisted material SLOT and camera/light, not its
actual shader sockets; this stronger assertion belongs specifically
to the later `look_render` live read-only preflight.

The broker checks these fields before any `render.execute`. Tests
reject changed base color, metallic/roughness, wrong upstream shader
revision, node-graph overrides and missing Principled nodes. This is
not a render-completion, appearance or final visual-quality attestation,
and no Blender application has been launched in this source-only CI.

## Shuvi 41 — persisted Copper shader parameters across independent save/reopen

The pinned upstream adapter already supports the typed read-only
`material.shader_inspect` operation. We now reuse the existing strict
`verify_shuvi41_copper_shader` validator when capturing the supplementary
`shuvi41-proof-material.blend` checkpoint in both the writer process and
the **separate read-only reopened Blender process**. This verifies the
Principled BSDF material name, exact one Principled node, bounded shader
node graph, immutable source-computed revision, fixed copper base color,
metallic (0.65) and roughness (0.31), with no incoming links overriding
the three fixed inputs. Writer/reopen snapshots must agree including
the shader-graph revision; a slot name alone is insufficient.

For this example Copper material only, the saved checkpoint receipt,
native output verifier and manifest now require the **actual independent
shader parameter evidence** and carry the bounded shader revision. Its
historical downstream manifest review checks these attestations and
current saved file SHA, but **does not** pretend to reopen Blender again
or recheck that the shader is still live inside the current file.
Normal `model1`, `model2`, `render` scenes and unrelated materials
are unchanged. The optional `look_render` still retains its separate
pre-render typed shader inspection at render time. No rendering, merge,
live Blender execution, arbitrary model code or approval bypass occurs.

## Shuvi 41 — actual rendered Copper shader routing guard

In addition to verifying the persisted Principled input numbers, the typed
`material.shader_inspect` preflight now requires exactly one
Material Output node and a **direct BSDF-to-Material-Output Surface link
from the validated Principled shader**. This closes a false-positive
case where metallic/roughness/base color match the recipe, but an
Emission or other shader actually drives the rendered material.
Duplicate links, absent source/destination nodes, ambiguous material
output nodes and linked overrides of fixed input sockets are rejected.
The same source-bound shader verifier is applied on saved-look writer,
independent read-only reopen, and just before material rendering.
No arbitrary shader mutation or Blender UI execution was introduced.

## Pinned upstream material shader contract QA

A new source-only integration test imports the actual pinned
`shuvi_blender_agent.material_nodes.MaterialNodeOperations` and
`ShaderInspect` parser, confirms `material.shader_inspect` is
registered as a `SafetyClass.READ_ONLY` typed tool, and verifies
that the upstream `inspection.revision` algorithm matches the fixed
Copper shader validator's canonical snapshot hash. This protects
against accidentally relying solely on locally mocked shader tools.
It uses a synthetic readback snapshot for the digest check; a real
Blender graph still requires the separate, explicitly approved host
acceptance run. No upstream repo files were changed.

## Team-41 — saved checkpoint full-scene census and exact pagination proof

The existing independent checkpoint reopen captures a bounded 1000-object
scene through typed read-only `objects.list` pages in both a writer and a
separate read-only Blender process. An object-page source reporting
duplicated IDs/names, a short page with a seemingly valid cursor or a
forged census could previously be canonicalized into an apparently
consistent fingerprint while displacing an unseen object.

Each page is now validated **before any secondary mesh inspection**:
exact page length for `offset`/`PAGE_SIZE=25`/`total`, canonical
continuation cursor, matching session and scene revision, valid lowercase
64-hex per-object revisions and globally unique session-owned object IDs
and visible names across all pages. The initial scene's nonnegative
`object_counts_by_type` census must sum to its object count and must
exactly match observed types across the completed pages. Missing, duplicated
or substituted scene objects cause fail-closed source rejection. Valid
empty scenes and 26-object/two-page scenes are regression tested.

Geometry validation additionally rejects polygons that repeat a vertex
index even if the upstream-provided SHA exactly matches that degenerate
payload, and bounds aggregate polygon indices to 32768 to avoid unbounded
mesh proof work. This is purely a read-only verification improvement;
there are no new edit permissions, arbitrary scripts, Blender host runs or
changes to the pinned upstream adapter.
