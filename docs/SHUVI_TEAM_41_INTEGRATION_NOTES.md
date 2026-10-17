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
