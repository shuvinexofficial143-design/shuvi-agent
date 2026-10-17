# Shuvi 38 — Native scheduler integration notes

Frozen shared base: `99c9e58ef0e43139edfe2d6464f6411be47e1aa0`; team branch: `feature/shuvi38-native-scheduler`.

## Milestone 1 (commit 33643435)
- Ordered earliest dependency-ready native DAG admission, fail-closed unresolved outcome across task resets; Rust tests and source CI 9/9 workflows, 18/18 checks.

## Milestone 2 (this change)
- Add `src-tauri/src/native_owned_process.rs` compiled under `native_scheduler.rs`; real Rust `Child` PID and exit status, bounded runtime, direct-owned-child cancellation by exact action UUID, process-wide one-child slot, bounded in-process one-launch-per-UUID replay guard, fail-closed cleanup on drop.
- Production spawn interface *requires* the existing `NativeExecutionLease` token, loads exact on-disk native scheduler and authoritative native-worker-job record, verifies the same running UUID/tool. No new public Tauri IPC, model executable or shell strings, no permission bypass, no provider retries or invented audit/progress.
- Worker command uses absolute canonical existing executable and cwd, bounded arguments, empty environment with only essential Windows OS vars, discarded stdio (no sensitive log leakage). Only trusted Rust adapter code may provide a hardcoded/validated command, never the AI model.
- Windows CI Rust tests spawn a real disposable `cmd.exe` and observe real PID/exit; cancellation tests kill the *direct owned child* and explicitly reject foreign action UUID. Node regression protects source guard contracts.

### Explicit limits / integration boundary
- This is a compiled **backend process supervision capability**, not yet called by Adobe/Blender adapters, and NOT an autonomous background worker scheduler. Code connecting `native_scheduler::owned_process::spawn_for_active_action` in a trusted adapter must maintain the same lease lifetime and native audit flow. No other team branch or shared `lib.rs` changed.
- Descendants are **not** contained by a Windows Job Object; `Child::kill` stops only our directly owned child. Never claim full process-tree cancellation or safely start arbitrary subprocess trees until containment is implemented. Child OS liveness/exit does not prove app progress or output artifacts.
- Owner-granted background resource lanes, IPC app heartbeat, crash-persistent owned PID registry, safe process-tree stop, full artifact receipt integration and live Windows editing all remain unfinished. Explicit safe-host consent is required for acceptance. Source CI success only attests runner tests.

## Later integrator
Review any adapter calls and potential cross-team shared-file overlap. Keep owner consent, OS lease, exact prepared UUID, audit journal and path/hash proof authoritative. No main merge without separate approval.

## Windows containment milestone
- Win32 CreateProcessW(CREATE_SUSPENDED) -> AssignProcessToJobObject -> ResumeThread; kill-on-close Job Object prevents unassigned worker execution.
- Bounded execution observes active descendant count; parent exit cannot unlock GUI lane while descendants remain. Timeout/cancel targets owned job group; no arbitrary PID kill.
- Rust Windows-runner tests and Node policy tests must pass at exact commit. No production adapter or live Windows app was invoked; CI source validation is not live verified.

## Lease lifetime hardening
- The backend worker process now takes ownership of the original NativeExecutionLease token rather than borrowing it for launch only. This makes the Rust ownership lane live until the worker object is dropped and its Job Object reports no active descendants.
- If OS termination cannot be verified, Drop intentionally forgets the lease so a second Windows mutation cannot start in the same Shuvi process; the persistent running journal still requires owner recovery. This is an exceptional fail-closed process-lifetime lock, not an automatic reset.

## Hermetic Windows runner regression
- 339cd1654e76 had 17/18 checks success; Rust suite: 427 passed, 2 failed, 1 ignored. Shell fixtures produced unreliable exit 0xFFFF0000 and no persistent grandchild.
- Use this same Rust test executable as explicit ignored worker/parent/grandchild process fixtures; no PowerShell or cmd in test execution.
- These regression fixtures are never part of production worker executable selection.

## Milestone 5 — durable native subprocess ownership journal
- New backend-only `native_process_receipt.rs` writes a crash-safe launch-intent **before** OS process startup, registers only the exact observed PID after spawn, and records terminal OS phase only once after confirmed process-tree termination.
- Launch-intent and running receipts persist across restart. Subsequent launches fail closed until an independent explicit owner review; no PID, exit=0, supervisor tick or receipt can claim application progress or tool audit. Existing `native_worker_job.json` and DAG audit authority remain unchanged.
- `spawn_for_active_action` requires scheduler + native-worker-job exact running action, owns the Windows execution lease for process lifetime, writes intent, launches contained subprocess, stores real PID, and publishes exit/cancel/timeout. No new model/provider command, no `lib.rs` or external Adobe/Blender adapter dispatch change.
- Rust unit regressions cover real on-disk crash/replay, UUID mismatch, exit vs audit, owner review seam, and corrupt/orphan receipt. `owner_review_at` is deliberately **not exposed** as IPC until the existing authenticated owner-review path is integrated; do not clear unknown on startup.

## Owner-reconciled process receipt admission (integration)
- Reuse the existing authorized `reconcile_native_worker_job` command and its exclusive desktop lease via `native_worker_job::reconcile`; validate current running NativeJob UUID+tool before marking matching process launch/PID evidence `owner_reviewed_unknown`.
- `native_worker_job::require_resolved` now also rejects outstanding/corrupt process receipts even if the main worker journal was somehow marked terminal. Foreign UUID owner review fails closed.
- Shared `src-tauri/src/lib.rs` unchanged; no UI or new IPC authority. Multi-file durable updates are deliberately ordered process review first, native job review last; on partial failure the still-running native job remains quarantined.

## Windows end-to-end journal integration test
- Rust Windows CI starts the exact ignored worker test binary, reads persisted launch intent/PID, observes a real exit, reloads durable OS-only terminal receipt, and confirms app progress remains unverified.

## Milestone 6 — real read-only PID/recovery visibility integrated into existing Tauri status
- The existing `native_worker_status` read-only Tauri command now loads **real durable subprocess receipt**, attaches OS PID, phase, exit code, containment flag and explicit `processHealth` to `NativeWorkerStatus`. No new command or mutation/permission entrypoint.
- On restart, an unresolved `launch_pending`/running OS receipt with no exact active owner UUID/tool + Rust journal forces existing `state=recovery_required`, `requiresOwnerReview=true`. Same-process matching journal is an identity attribution only, NOT a live Windows process signal.
- `processOsLivenessVerified=false`, `processAppProgressVerified=false` and `safeToAutoRetry=false` always. Exit code 0 cannot become an app/task audit. Corrupt and orphaned receipts fail the status read explicitly and still fail closed on new dispatch.
- **Shared-file overlap:** single read-only edit to `src-tauri/src/lib.rs` at `native_worker_status` command, adding receipt read + status attachment only; no other shared command, Tauri registration, UI, permission, or execution path was changed. Team 37 frontend may choose to render these new additive status keys after integration review; existing state-based RECOVERY REQUIRED UI already observes the modified state.
- Rust regression tests cover crash PID with no lease, matching live UUID, mismatched UUID, successful OS exit vs application audit. Node drift test covers connection. Still no Adobe/Blender adapter process replacement or live host acceptance.

## Milestone 7 — approved scheduled Blender read-only process is now actually supervised
- **Integration:** a prepared/approved `blender_inspect` action with a native task-graph step routes through `native_blender_owned_adapter::inspect` in the existing `execute_action` Tauri command. The unscheduled/manual `BlenderInspect` path and all other tools retain their existing adapter; no new Tauri IPC or model code execution.
- Rust validates the fixed bundled script, approved Python/Blender exe paths, optional .blend input and read-only operation, constructs only fixed CLI flags, runs the Python launcher as a real `native_scheduler::owned_process::spawn_for_active_action` child under exact on-disk schedule/job UUID and original Windows lease. Process is CREATE_SUSPENDED -> assigned kill-on-close Job Object -> resumed; full subprocess descendants are contained.
- The existing fixed Python worker now *optionally* accepts a private `--result-file` and writes bounded JSON via exclusive create + fsync. Historical stdout behavior is intact for other callers. Rust validates regular file, private canonical directory, bounded bytes, exact operation, authenticated handshake and no-mutation/no-render flags. Exit=0/PID alone cannot claim success.
- Original OS-wide desktop lease is taken by the owned child then handed back only after verified process-tree termination, remaining held during evidence readback and durable `execute_action` audit; unexpected termination remains fail closed.
- **Shared overlap:** `src-tauri/src/lib.rs` adds one module declaration and a narrow scheduled `blender_inspect` routing branch in the existing authorized action command. `integrations/blender-worker/shuvi_blender_bridge.py` adds optional private evidence output with historical stdout intact. Coordinate with Blender/team 37 integrators; no changes to main, other teams, frontend, provider commands, or Adobe runtimes. Live Blender/Windows user-session acceptance still unverified.

## Milestone 8 — owner Remote Stop for exact PID-owned action
- Existing `cancel_running_action` IPC now dispatches approved **running** `blender_inspect`/`blender_run_plan` action IDs to Rust `request_cancel_exact`. If no live matching PID-owned child exists it returns `false`; it never falls back to PID-based taskkill or cancels a foreign child.
- Native supervisor checks the same action's cancel flag on its 20 ms bounded poll and invokes existing owned Windows Job Object tree termination, including durable cancelled OS receipt. This is a request acknowledgement only, not fake app outcome/target proof; the executing tool audit later records error after cancellation.
- Non-Blender legacy cancellation behavior unchanged. No new IPC. Regression guards cover exact UUID and retained Job Object cancellation.

## Milestone 9 — approved scheduled Blender plan under real process-tree supervisor
- Exact approved DAG step `blender_run_plan` in `execute_action` now calls `native_blender_owned_plan::execute`; unscheduled legacy adapter unchanged. The same original Windows lease is owned by the new suspended/Job Object process launcher, then returned only after terminal process tree for final SHA-256 artifact proof and Rust audit.
- Explicit `allow_render`, fixed Python/Blender executables, fixed bundled `shuvi_blender_plan.py`, bounded 64 KiB private declarative JSON plan and 120-second absolute execution cap. Python plan preflight, typed operations, SafetyPolicy(allow_destructive=False), final Blender authenticated readback, checkpoint/render output verification all preserved.
- Python adds optional exclusive 1 MiB `--result-file` (+fsync) while preserving existing stdout mode. Rust checks exact success/readback, action and render flags, then calls the SAME legacy `blender_plan_worker::verify_output` to SHA-256 re-read artifact in approved folder. Any partial/unknown outcome errors out and must be inspected before retry.
- Regression tests cover schema/render permit, fixed invocation, private evidence, lease continuity and bounded input. No unrestricted Tauri command, remote host execution, deployment or unrelated team file modifications.

## Milestone 10 — job-wide RAM ceiling + exact cancellation and artifact regressions
- Windows Job Object now sets `JOB_OBJECT_LIMIT_JOB_MEMORY` to **4 GiB** (fail-closed on architecture unsupported). The existing original Blender plan hard-memory rule is therefore not bypassed when execution is routed through suspended native process launcher. The cap applies to aggregate memory commitment of the contained process tree, not an invented app heartbeat.
- New Windows native test starts a real contained slow Rust child, checks foreign UUID cancel is rejected, requests exact UUID Remote Stop, observes `cancelled` terminal and no app progress, then checks cancellation is no longer available after reaping.
- New artifact hash test writes a mismatching file/receipt and demands rejection before task completion; 4 GiB Job Object flags get a Node source contract check. No live host action was taken.

## Milestone 11 — original 4 GB Shuvi+worker RAM guard retained
- Blender PID-owned inspection and plan register exact native child PID into existing managed-process identity registry (real process start time), with RAII cleanup after terminal process-tree observation. Old remote-cancel taskkill is NOT used: exact UUID Job Object stop remains authoritative.
- Both supervised Blender adapters now execute `wait_bounded_with_host_budget` to sample existing `current_runtime_status(state)` every 250 ms. If measured combined Shuvi/managed worker tree exceeds 4 GB or cannot be verified, stop that exact owned Job Object, report failed/unknown external effects, do not silently retry. Independent Windows Job Object 4 GiB committed-memory guard remains in force.
- Existing high-level owner permission, native durable audit and SHA256 artifact checks are unchanged. Regression contract requires both Blender paths to register PID, sample budget and unregister terminal PID before final audit.

## Milestone 12 — Windows behavioral proof of 4 GB watchdog
- Refactor existing real host RAM sampler behind a private injectable predicate (production path still calls `current_runtime_status(state)` every 250 ms). This makes exact tree-kill behavior independently testable without exhausting CI RAM.
- Two Windows Rust tests spawn actual suspended, Job-contained Rust worker processes: over-hard-limit true and measurement unavailable. Both must stop **only** the currently owned process tree, return an error, and leave app progress explicitly unverified.
- Preserve memory accounting registration RAII, original action UUID, audit and user review controls; no new frontend privilege.

## Milestone 13 — durable exact-action verified Blender artifact delivery
- New `native_blender_action_artifact.rs` stores an immutable bounded per-action UUID artifact certificate ONLY after PID-owned worker exit=0, authenticated readback, all descendants terminated, and exact rehash. Certificates are private on-disk records keyed by UUID; corrupt/duplicate/tampered receipts fail closed. This is not an OS liveness or creative-quality guarantee.
- `native_blender_owned_plan::execute` records a certificate while the original OS execution lease is still held and before the main `execute_action` audit. A certificate created before an audit failure cannot pass final delivery because existing audited DAG + action receipt checks remain mandatory.
- `native_task_delivery::finalize` additionally insists every Blender step's exact UUID, path, bytes and SHA256 match its supervised worker certificate. This prevents an arbitrary externally existing .blend/.png being offered as the scheduled Blender action's output. No bypass for legacy handoff: old scheduled Blender deliveries without this new certificate require independent owner review/migration.
- One shared `lib.rs` module declaration. No provider command, Adobe runtime, main branch, or live desktop used. Rust unit and Node regression tests cover persisted evidence, duplicate UUID, foreign artifact, file tampering, corrupt certificate, and end-to-end call order. Certificate store is bounded to 1024 records; full storage fails closed, requiring operator archival.

## Milestone 13 regression extension
- Added a pure final-delivery acceptance seam (`require_exact_at`) tested with real temporary .blend bytes and SHA-256, not just source-regex assertions. Tests positively accept only matching action/size/hash/path and reject swapped UUID, substituted path, forged hash/bytes, and file tampering after certification. Production uses the same seam via the app-private evidence directory.

## Milestone 14 — restart-persistent native UUID replay history
- Existing v1 `native-worker-process.json` now retains up to 48 most recent prior launched UUIDs. `begin_at` rejects the currently active UUID and recent prior UUIDs even after later actions and host restarts, without changing the main action journal authority or auto-retrying unknown outcomes.
- Files serialized before this feature remain backwards compatible via serde(default). Bounded history is checked for duplicate/forged UUIDs and current action duplication, maximum receipt budget raised to 4096 bytes. Rust disk-based tests cover A→B→old-A replay and old-file migration.

## Milestone 15 — proactive artifact store capacity and UUID preflight
- Scheduled Blender plan now rejects an already-certified UUID or a full/corrupt private output certificate slot **before** launching any Python/Blender worker process. Publication rechecks under the same journal mutex, and authorized native GUI lock prevents a competing worker between preflight and publication.
- If the private certificate store fills, owner archival is needed; no unverified creative work is started just to discover a delivery-capacity failure. Rust tests cover duplicate action and crash-interrupted `.tmp` receipts.

## Milestone 16 — historical completed-task provenance re-verification
- `native_task_delivery::read` now rechecks the same exact Blender certificate, action UUID, file path, bytes and SHA256 as `finalize`. A replaced/deleted certificate or tampered file therefore invalidates subsequent *read-only* delivery inspection instead of leaving a stale green verification.
- One shared private verification function is called from both finalize and read; no new mutation IPC, and old non-Blender deliveries retain their previous behavior. Historic scheduled Blender receipts without an authenticated certificate fail closed and need owner-assisted inspection.

## Milestone 17 — automatic Blender artifact assembly for completed DAG delivery
- `native_task_delivery::finalize` now hydrates a missing `blender_run_plan` artifact directly from the exact worker UUID's immutable certificate using `read_verified`, which independently rehashes the actual file. This removes the manual/AI-supplied path/hash step when preparing a final task delivery.
- Existing complete ordered DAG + Rust successful action audits + UUID+artifact provenance rechecks remain mandatory. Explicitly supplied artifact metadata are **never silently replaced**; they must match the existing certificate. Other tool kinds (including Remotion/Adobe) are unchanged.
- Two Rust and two Node tests cover auto-hydration, zero unrelated tool lookups, absent certificate fail-closed, and wrong artifact kind rejection.

## Milestone 18 — terminal cancellation race eliminated + exact Blender plan/readback binding
- Remote Stop now targets only the **actually running** owned process. Durable process termination and freeing the in-process cancellation slot are serialized under the same Rust process-owner mutex, *before* the supervisor returns to artifact rehash and higher-level audited delivery. The separately held Windows desktop lease remains protected until the Rust action finishes.
- If an exact cancel was requested before terminal publication, an OS exit 0 cannot silently erase that request or become task success: recorded phase becomes cancelled. Requests after terminal are rejected as no active owned process. This closes the late-stop race where a user could see an accepted Stop while Shuvi proceeded to a successful audit.
- Scheduled Blender plan additionally preflights bounded timeout, 1..6 uniquely named typed operations, declared output operation and render permission prior to OS launch. Authenticated result's `final_operation` and `executed_steps` must exactly match the approved plan. Inconsistent (but superficially authenticated) host readbacks fail before artifact certification or task audit.
- Added real Windows child process regressions and Rust forged-response tests; Node source checks enforce actual status transitions. No new Tauri IPC, subprocess rights, provider calls or host deployment.

## Milestone 18 — output format cross-check
- Final delivery now also checks approved final operation against file type at the Rust boundary: `render.execute` must deliver `.png` and `file.checkpoint` must deliver `.blend`, independent of Python-side safety. SHA-256 alone cannot make the wrong kind of file valid. A Rust on-disk forged-output regression constructs a **correct hash for a wrong-type artifact** and expects rejection, with Node static guard for the exact extension decision.

## Milestone 19 — durable owner Stop intent and restart-safe read-only status
- Existing approved Remote Stop `cancel_running_action` now calls `request_cancel_exact_persisted(app,uuid)` and commits `cancelRequested=true` into the bounded PID receipt **before acknowledging owner Stop**. Terminal publication holds the same Rust process-owner mutex, closing the acceptance race. No PID-based kill or new IPC. If disk evidence cannot be written, still request termination but return an error; owner must review uncertain effects.
- Backward compatible serde(default) record field; a stop-requested receipt cannot be forged into `exited`/success, and prior launch/PID state persists across restart. `native_worker_status` reports `processCancelRequested` and distinguishes pending Stop from actual application progress. A crashed host remains `recovery_required` without automatic retry.
- Real on-disk Rust tests cover foreign UUID rejection, accepted stop before PID acknowledgement, restart readback and forged zero exit. Status tests cover unresolved owner Stop after host restart; Node checks verify only the existing owner IPC is wired.

## Milestone 20 — exact approved Blender input hash / Rust–Python evidence binding
- Fixed the stale Node contract that still matched the older 4-argument `native_plan_response`; it now guards the real exact-operation and step-count version rather than weakening any code verification.
- The approved scheduled Rust Blender plan now computes SHA-256 over the precise UTF-8 JSON bytes staged for the child. The bundled Python worker independently hashes those exact bytes before parsing and emits `approved_plan_sha256` only in verified authenticated output. Rust requires an exact lowercase 64-hex match **before** artifact verification or UUID certificate creation. This prevents accepting a stale/different plan response having the same last step, step count, and otherwise valid artifact.
- Old stdout output mode remains operational; it also reports the digest. No new arbitrary executable path, permission, model command, or remote host action. Rust unit tests cover match, missing, wrong, uppercase and altered plan; Node regressions guard both endpoints and the repaired signature.

## Milestone 21 — durable full-plan provenance in exact UUID artifact certificates
- New supervised Blender `record_verified` now *requires* the independently checked lowercase `approved_plan_sha256` emitted through the Python→Rust full-plan binding, persisting it in the immutable action-UUID artifact certificate alongside path, bytes, and file hash. A missing/invalid fingerprint fails before certificate creation. Read-only certificate read and final task delivery continue to rehash the real output.
- Historical v1 certificates lacking `planSha256` remain parseable with `None`, never silently upgraded or mislabeled as proving plan integrity. New certificate validations reject malformed or uppercase digests. Disk-reload and legacy-migration Rust tests plus Node source contract added. Existing artifact delivery schema and no-new-IPC rule preserved.

## Milestone 22 — full-plan input fingerprint in final, restart-verifiable DAG delivery
- Added an optional backward-compatible `approvedPlanSha256` field to `DeliveryArtifact`, restricted to verified `blender_run_plan` outputs. New `finalize` auto-fills this from the action UUID's Rust-verified immutable certificate without replacing any explicitly supplied path, bytes or output file hash, and rejects wrong UUID/output fingerprint or a conflicting plan digest.
- Historical v1 delivery JSON without the additive field remains readable. When a historical record has no digest, Shuvi does NOT claim it proves which plan ran. If a final delivery contains the digest, every owner `read` revalidates it against the exact current independently rehashed action certificate. Rust tests exercise positive autofill, forged digest, foreign output, non-Blender rejection; Node guards actual final/read paths.

## Milestone 23 — authenticated Blender worker heartbeat and app ACK supervision
- The approved `blender_run_plan` Rust adapter creates a per-launch private 256-bit key and bounded JSON sidecar, tied to the **exact native action UUID and SHA256 of staged approved plan bytes**; no new frontend/model-native shell command or permission is exposed. Existing unscheduled stdout worker remains compatible.
- Bundled Python emits HMAC-SHA256 authenticated monotonic worker pulses every ~3 s. Stage `python_active` proves only the Python loop, never Blender progress; `blender_session_attached`, `plan_verified` and `artifact_rehashed` are promoted only after their corresponding actual Python/Blender readbacks. The protocol is not a true Adobe heartbeat or per-step Blender percentage.
- Owned Windows Job Object loop independently validates signed action/plan identity, stage monotonicity and freshness with Rust `Instant`; missing startup ACK, forged/corrupt pulse, stopped loop or regression causes full owned tree stop and an unresolved-result error. Existing 4 GiB host budget, PID journal, owner Stop, OS lease and SHA256 delivery checks remain mandatory. Clean OS exit is not success: verified final pulse, authenticated final worker receipt, artifact rehash and UUID certificate still required.
- Old receipt schemas remain unchanged, pulse/key are private per-action ephemeral data deleted on completion. Rust unit regressions and Node cross-language source checks cover legitimate staged ACK, foreign UUID/plan, replay, malformed bytes and missing final proof. User Windows installed-Blender live acceptance remains **NOT VERIFIED**.

- Added a disposable Windows **real child** regression for invalid heartbeat causing termination of the owned process, not just a static source assertion. The first sampled message may legitimately carry a later signed stage if multiple authenticated worker transitions occurred before the 250 ms Rust sample; the verifier therefore accepts such a first sample, but never accepts subsequent regressions, bad MACs or cross-action evidence.

## Milestone 24 — durable project/output resource claims and crash-quarantined admission
- Trusted, approved scheduled \`blender_run_plan\` now canonicalizes the real read-only input project and writable output directory, persists an exact action UUID resource claim **before** its Windows-owned process can launch, and rejects output collisions / folder nesting against other retained claims. Disjoint output reservations and shared read-only source projects have explicit bounded admission contracts.
- Claim journal is crash-safe, private, bounded, input-validated and denies forged overlapping state / orphan backup. A crash before the Rust audit (including OS PID uncertainty) leaves its resource held; there is no timeout unlock or blanket owner review release.
- A claimed output is released only after the **matching durable Rust audit SUCCESS** and independent UUID Blake/Blender artifact certificate reread/SHA256 verification, including a crash gap between audited journal and release. A failed or uncertain action never automatically releases its writable output.
- Rust on-disk regression tests cover disjoint claims, shared readers, nested writer collisions, disk restart, misattributed artifact, corrupted journal and exact-UUID replay; new Node contract tests guard the approved production wiring and exclusive desktop/OS process lanes.
- IMPORTANT: This provides real project/output **resource ownership admission**, not yet concurrent OS worker execution. Existing Windows GUI lease and one native PID-owner remain exclusive; the next step is disjoint, non-GUI owned background process execution with cross-process-safe leases and strict budgets. No user Windows live acceptance performed.

## Milestone 25 — real bounded parallel, READ-ONLY artifact verification workers
- After the existing full Rust DAG exact-action audit matching, final-delivery verification now uses two scoped Rust threads for independent canonical artifact paths; SHA-256 is streamed in 64 KiB chunks, bounded by the existing 512 MiB per-file cap. Both threads are always joined (including failure), no untracked OS subprocess or desktop app is opened.
- Two receipts for the same canonical file are rechecked serially; missing/inaccessible paths or tampered length/hash fail closed. Final delivery still independently rechecks Blender certificates and never upgrades failed/audited-unknown tasks.
- Rust tests create real disposable files for parallel admission, alias fallback and post-verification tampering. Node regression covers audited-before-hash ordering and bounded concurrent read-only scope.
- IMPORTANT: This is actual concurrent BACKGROUND FILE VERIFICATION, NOT parallel Windows GUI execution or true independently owned Blender/Adobe processes. GUI OS lease/PID path stays exclusive.

## Milestone 26 — kernel-backed cross-process exclusive resource ledger transactions
- Keep Rust's existing intra-process mutex and additionally acquire a fixed-file kernel-backed exclusive lock on each ledger mutation: Win32 file open with \`share_mode(0)\`; Unix advisory \`flock(LOCK_EX|LOCK_NB)\` for developer/test portability. Lock is held across complete read/verify/update/durable persist and dropped automatically by OS on process death, while **held resource UUIDs remain on disk** and cannot be cleared by crash or TTL.
- Another Shuvi instance holding this lock yields a fail-closed resource conflict rather than a second simultaneous writer; corrupted file/reparse-point lock path is denied. No new permissions/IPC/GUI lanes; existing single desktop lease remains unchanged.
- Real Rust multi-thread writer-collision and locked-ledger regression, with Node source contract for the Windows OS lock and both write seams. This protects against cross-instance ledger lost updates but does not yet make native GUI workers concurrent.

## Milestone 27 — owner-verified restart reconciliation and prelaunch lease guard
- Extend the **existing** owner-authorized native journal reconciliation, not a second permission system: if an interrupted action is independently reconciled to a genuine Rust audit success, the exact UUID resource claim can release only after native artifact certificate readback and independent SHA-256 file check. Reconciled unknown/failed actions remain held.
- Reject missing desktop lease **before** a Blender output resource is reserved; never create a permanent claim for a request that fails merely because the native lease was missing. Failed spawn after durable intent stays quarantined as uncertain.
- Node regression ensures owner-path exact audit, authenticated certificate gate, strict ordering of desktop lease/output reservation and no forged automatic retry. Source testing is not Windows application live acceptance.

### Milestone 27 recovery integrity hardening
- Before recording a post-crash owner-confirmed SUCCESS for an interrupted \`blender_run_plan\`, the existing reconciliation path now independently verifies the exact native UUID artifact certificate, including actual on-disk SHA256. Failures occur **before** owner process receipt / Rust audit are written, preventing a false successful dependency from unlocking downstream DAG admission. Unknown/failed reviews remain possible but never become verified Blender delivery.
- Node regression enforces this pre-audit gate precedes the existing recovery mutation and later verified resource release.

## Milestone 28 — transitive Blender artifact rehash before DAG admission and restart success
- An already-audited Blender step is **not permanently trusted** for dependent work. Before scheduling a successor, the real Rust API recursively checks every transitive Blender ancestor by exact UUID against its SHA-256-on-disk certificate; immediate preflight and final begin entrypoints each recheck. A non-Blender intermediary does not mask a missing/tampered Blender checkpoint.
- Crash-recovered success is verified against exact UUID artifact **before** scheduler durable terminal promotion. Read-only status refuses to project verified Blender success if earlier output bytes no longer agree. Native journal success also rehashes first, preventing a timing gap between output creation and action audit publication.
- Offline Rust tests cover transitive DAG, tamper denial and restart-success projection; Node contracts cover production-path wiring. This adds bounded readback I/O, not any Windows GUI, cloud provider or side-effecting worker.

## Milestone 29 — physical file identity and stable SHA-256 read leases
- The two-worker read-only delivery verifier now considers real filesystem identity, not just canonical path strings: Unix device/inode or the Windows kernel GetFileInformationByHandle volume/index pair. Distinct names pointing to one hard-linked output serialize their readback; only truly disjoint physical files get concurrent verification threads.
- Final artifact hashing opens a read-only Windows handle with FILE_SHARE_READ (denies concurrent writer/delete/rename share), captures original file identity and length/mtime, streams SHA256 with 64 KiB buffer, and rechecks the exact handle and pathname identity after completion. Missing, swapped, symlink/reparse, modified or malformed outputs fail closed.
- Exact Blender UUID artifact certificate readback similarly uses a Windows read-only share lease and before/after byte-size and timestamp verification. No additional GUI command or permission is introduced.
- Real Rust disk hardlink/identity tests and Node production-path contract tests added; these protect against ordinary alias/race cases but are not a claim of hostile-kernel-proof atomic verification or Windows Adobe live acceptance.

## Milestone 30 — deterministic physical-resource-aware two-worker admission
- The background SHA256 verifier now preserves earliest pending delivery order but searches ahead for the earliest **physically independent** output to pair with the head job. With A, hardlink-to-A, independent B, it verifies A+B concurrently and then serially checks the alias, instead of leaving an independent worker idle.
- The ready queue is bounded by the existing 48-step verified native DAG, at most two Rust scoped threads, and existing per-file 512 MiB / 64 KiB chunk bounds. Each successful attempt still requires its exact immutable source audit and stored SHA256; failed or conflicting reads never finalize the task.
- New Rust test produces real hardlinked A/alias plus independent B and measures the actual peak verifier concurrency; the Node contract checks the production queue algorithm. No additional GUI/Blender/Adobe process is dispatched.

### Milestone 30 source-hardening: keep status polling bounded
- Read-only `verified_status` projects durable Rust audits and checks an individual interrupted Blender recovery, but deliberately does **not** scan/re-SHA256 every historical Blender file on each UI refresh. Active dispatch preflight, immediate begin, crash-success audit and final deliverable still require fresh exact-UUID on-disk proof; a status row's historical audit phase is not an independently current artifact hash.

## Milestone 31 — Owner-visible cross-process resource status
- Existing read-only native_worker_status now adds bounded canonical read/write path holdings, exact action UUID/tool, recorded reason for each held output, and recent retired action count. No new command or approval bypass.
- Snapshot uses both IO mutex and OS cross-process ledger lock, and rejects corrupt/missing-with-backup journals; it never rehashes a whole Blender project during UI polling, releases a claim, proves app liveness or authorizes retry.
- Unknown, orphaned and failed held resources require owner review, while a matching journal success still shows output-held until separately released by the verified-certificate pathway.
- Rust real-file restart, corruption and cross-process lock tests plus Node native UI status contracts added. Live Windows host acceptance remains unverified.

## Milestone 32 — approved plan provenance bound to prelaunch resource claims
- Newly scheduled approved Blender plans now persist the SHA-256 of the *exact full approved plan bytes* in their durable exact-action resource hold before OS worker launch. The existing plan worker and artifact certificate already hash the same bytes, so this provides a cross-restart plan-to-output binding without model-selected script/permissions.
- Releasing the owned output after real Rust audit plus rehashed artifact certificate additionally requires its stored approved-plan digest to match certificate plan SHA-256. Missing/foreign digest cannot free a new-format claimed path even if output filename or exit-code looks plausible.
- Existing historical v1 resource claims remain readable with optional digest absent but are never mislabeled as plan-provenance verified. Owner-facing resource status now includes optional approved digest, not a forged success flag.
- Rust disk-restart, wrong plan, legacy compatibility and UUID replay tests plus Node wiring contracts added. Windows app live acceptance still separate.

## Milestone 33 — Windows desktop reserved-output owner panel
- Added a collapsible, read-only "Reserved outputs" section to the already-present native sidebar, sourced solely from the existing authenticated Rust native_worker_status Tauri command. Displays exact tool/UUID prefix, bounded canonical output path, reason reservation persists, and optional approved plan digest prefix.
- Strict TypeScript contract validation accepts at most 12 held Blender claims with exactly one output path, UUID format, bounded paths, lowercase SHA256, no forged evidence/safe retry flags and consistent durable count. Failure displays "unavailable", never fake idle.
- Paths and unknown status strings use DOM textContent only, never innerHTML; no UI control can force-unlock or replay a claim. Every four-second existing worker-status refresh updates the panel without new independent OS calls.
- Added Node UI wiring/HTML injection/safety tests; Native Rust and UI source CI verification required. Real installed Windows acceptance not yet conducted.

### Milestone 33 CI correction — exact source and Rust test repair
- Fixed the previously incomplete `Hold` Rust test fixture to explicitly initialize the backward-compatible optional approved plan digest field. The actual production SHA-256 binding and fail-closed release remain unchanged.
- Updated the preexisting owner-recovery source contract to the new explicit `certificate.plan_sha256` release argument, and replaced accidentally over-escaped test regex checks with exact, checked JavaScript source-contract string assertions.
- These corrections target concrete failures in GitHub CI of previous HEAD d4f505918e60; verify all tests against this new immutable commit before marking Rust or frontend success.

## Milestone 34 — durable HMAC-authenticated Blender worker-stage telemetry
- Existing supervised Python worker HMAC stages (python_active, blender_session_attached, plan_verified, artifact_rehashed) now have a private, bounded Rust-only journal. The supervisor writes a stage only **after** verifying action UUID, complete approved plan SHA256, HMAC, sequence and nonregression. A fast final pulse is also captured on process termination.
- The evidence journal is restart-readable but cannot be interpreted as live Blender application progress, a real OS process heartbeat, completion/audit success, or permission for automatic replay. Corrupt journal, regressed sequence or changed same-action plan digest fails closed. The existing exclusive GUI/owned process path and 4 GB memory protection are unchanged.
- Existing native_worker_status can expose the last matching attested stage to the desktop, which shows it explicitly labeled as signed Python worker evidence only. User application live validation remains separate.
- Rust unit and Node source regression tests cover progression, replay, corruption, wrong UUID/plan, and no fabricated success; CI results must be checked on the exact new HEAD.

### Milestone 34 source-check compatibility correction
- Updated the existing Blender host-memory watchdog source regression to recognize the bounded FnMut monitor body that first verifies the signed worker pulse and only then persists a stage. Original PID registration, 4 GiB guard, OS-owned Stop semantics remain checked.
- Narrowed optional worker sequence with a runtime typeof guard before integer/range comparisons in TypeScript; reject malformed signed-worker telemetry rather than silently allowing unverified values.

### Milestone 34 restart UI completeness
- Read-only worker status now displays the last *signed Python worker* stage in the `recovery_required` and `owner_reviewed_unknown` view as well as during an in-flight job. Its label explicitly says it is not Blender app success or OS liveness and never authorizes retry. This closes the gap where evidence was durable in Rust but invisible after app restart.

## Milestone 35 — cross-instance signed-stage journal isolation and exact-plan ownership gate
- Every durable Python-stage write now verifies the *current* exact action UUID, running Rust NativeJob, and a matching prelaunch, cross-process-locked held output claim with the same full approved-plan SHA256; a legacy/foreign/missing plan cannot create new stage evidence.
- Stage journal reads and writes acquire both the in-process Rust mutex and a fixed OS-backed lock: Win32 share-mode-zero file handle or Unix nonblocking flock. Corrupt lock paths and conflicting Shuvi instances fail closed. No TTL/force-unlock.
- Same-action stage sequence/timestamp regressions and same-sequence altered timestamp are rejected; unchanged duplicate readback remains idempotent. The archived journal is explicitly labeled as **Rust-recorded HMAC-checked evidence, not a freshly re-authenticated HMAC**, Blender progress, success, or OS liveness.
- Added real filesystem Rust tests for OS-lock contention, replay/backdating and the plan-claim gate; extended frontend source safety contracts. Existing Windows OS/GUI single-lane lease remains exclusive.

### Milestone 35 authenticated final-pulse idempotency
- The final worker pulse may be observed by the bounded monitor and then again by the terminal artifact-ack path. An identical action/plan/sequence/stage is accepted idempotently without changing the persisted observed timestamp; a changed stage with the same sequence, regressed sequence or backdated new stage is rejected. Added real Rust disk test for both cases.

### Milestone 35 source terminology compatibility
- Updated the recovery UI source-contract test to the more accurate archival evidence label: signed HMAC was verified before Rust recorded the stage, but a persisted JSON stage is **not** cryptographically re-authenticated on a future status read. No automation or liveness assertion is derived.

## Milestone 36 — OS-backed serialized NativeJob transactions across Shuvi instances
- Added durable native-worker journal exclusion on **all** begin, supervisor heartbeat/tick, final audit, owner reconciliation and status read operations. In addition to the existing Rust mutex, every transaction takes an exclusive OS file-handle lock beside the existing `native-worker-job.json`: Windows zero-share/reparse-safe handle and Unix nonblocking flock. No TTL releases, stale overwrite or automatic retry.
- An OS process crash drops only the kernel lock; the last on-disk `running`, `audit_verified` or `owner_reviewed_unknown` state remains intact and is independently validated before dispatch. Lock contention/corruption is an error, never an empty/idle journal.
- Added real Rust tests for cross-instance lock contention on every transition, competing begin attempts, concurrent tick/final audit, and forged directory at lock path; new Node contract verifies production seam ordering. No change to existing native desktop OS lease, approval checks, worker PID ownership, or Windows app live validation.

## Milestone 37 — OS-serialized PID receipt and owner Stop-vs-exit ordering
- Added fixed kernel-backed exclusion to the durable OS-process receipt across **all** launch-intent, PID registration, owner Stop intent, terminal exit and owner review transactions, plus read-only status reads. Local `JOURNAL_LOCK` remains; Windows zero-share handle with reparse-point protections and Unix nonblocking flock prevent cross-process lost updates.
- A recognized owner Stop is written under the same OS receipt lock, so no competing instance can publish `exited(0)` over the acknowledged cancellation. No raw foreign PID stop, fake application progress, automatic retry, lease release or process kill was added.
- Added disk-backed Rust stop-vs-exit race and cross-instance lock contention/forged lock tests, and Node regression contracts for all active paths. The signed worker journal, approval leases and earlier 36 milestone behaviors are retained.

### Milestones 36–37 Windows Rust compilation correction
- Exact Windows compiler E0599 at NativeJob and ProcessReceipt reparse-safe handle validation: explicitly imported `std::os::windows::fs::MetadataExt` alongside `OpenOptionsExt` inside the OS lock's Windows handle branch. Preserve, rather than weaken, the fail-closed file-attribute check. Re-run the exact new commit's Windows Native/Rust CI before asserting successful validation.

## Milestone 38 — cross-process native DAG journal, UUID-exclusive admission
- Every authoritative DAG transition (`preflight_at`, `begin_at`, `finish_at`, failed-step review, exact audit recovery) and owner-visible verified-status/read now has both a Rust mutex and a fixed **OS-exclusive lock** around the on-disk schedule. Windows uses zero-share reparse-safe handles; Unix uses nonblocking flock.
- Two independent Shuvi instances can no longer both dispatch the same ready DAG step under separate UUIDs by racing a read-modify-write; file lock contention and a spoofed directory/reparse lock path fail closed, never imply an empty task queue or application success.
- Added actual Rust thread race tests for simultaneous step start, lock contention through audit/review/status and forged lock path; Node tests inspect real production locks. Existing one-native-GUI-at-a-time and permission requirements remain intact.

## Milestone 39 — cross-journal plan-evidence coherence at owner status
- Rust's status adapter now correlates an HMAC-checked archived Python Stage with the *currently held* Blender resource claim by exact action UUID and complete Approved Plan SHA256; a missing claim for a running action, a mismatched plan digest, or a future-dated stage forces owner review and suppresses misleading stage display. Historical audited actions whose verified output claims have been released may still display explicitly archival stage information.
- This is read-only fail-closed status reconciliation; it never proves OS liveness, grants GUI/Blender mutation permission, certifies an artifact, replays a job or automatically frees claims. New Rust unit tests cover valid provenance, wrong digest, missing held claim and released historical success, plus Node production contract tests.
- The old scheduler terminal-status source assertion was also updated to require the **new kernel-locked read** rather than a removed unchecked `read_at(&path(app)?)` implementation; no application safety check was weakened.

### Milestone 38 test robustness
- Kernel contention and forged-lock-path tests now use the actual `model/blender_run_plan` ready DAG step instead of a deliberately invalid step identifier; preflight proves the same request passes before adding the conflicting lock. With lock removed, the identical action succeeds. This prevents false-positive tests that would pass even with broken locking.

## Milestone 40 — two global OS-backed slots for real read-only hash workers
- The actual final-delivery SHA256 verification threads now acquire one of exactly TWO per-user kernel-exclusive slots across all Shuvi instances for the whole streaming artifact read. Two desktop app instances cannot each start two independent file-stream hashers and overload the host. All existing exact audited UUID, 512 MiB artifact cap, 64 KiB buffer, disk identity and same-file serializing checks remain.
- Windows uses reparse-safe zero-share OS handles; Unix uses flock. A third parallel verifier, forged lock directory, or inaccessible slot fails closed without publishing delivery. A crashed process automatically releases its handle but never proves task success. No new OS child process, GUI action, permission or automatic retry is introduced.
- Added real Rust thread/slot exhaustion/release/corrupt sidecar tests and Node wiring regressions. This makes **Rust background hashing concurrency** cross-process bounded, not full independent OS subprocess execution.

### Milestone 40 inherited source-contract correction
- Updated the earlier two-worker hash regression to assert that the exact successful UUID/tool audit loop precedes the now-kernel-budgeted `verify_artifacts_bounded` closure. It also requires the production `HashSlot::take` and the same `check_artifact` SHA256 verification rather than matching an obsolete bare function argument.

### Milestone 38 fixture compile repair
- On latest M40 HEAD the Windows rustc `E0382` in a **test fixture** used `lock:PathBuf` after `remove_dir(lock)` consumed it. Changed to `remove_dir(&lock)` to preserve the PathBuf for later cleanup. The production OS lock, concurrency behavior and verified actual-step fixture were not altered. Recheck exact new SHA CI.

## Milestone 41 — globally budget every Final Delivery rehash, not only parallel workers
- Fixed actual cross-instance worker-budget coverage: earlier M40 guarded the two-thread batch but other final-delivery reads could hash bytes outside the two kernel slots. `finalize` now acquires an exclusive global hash slot for the missing-Blender-artifact certificate readback, the separately verified full-plan provenance hydration, optional trusted byte-count SHA read, and final certificate verification. The already-audited parallel artifact verification still uses per-worker independent slots.
- The read-only **historical receipt inspection** also acquires a hash slot around each actual artifact SHA read and the subsequent Blender certificate rehash. No file contents, native permissions, DAG ordering, exit statuses, or recovery states are synthesized from the lock. Slot exhaustion fails closed and never commits a delivery receipt.
- Source-contract tests assert coverage across all final-delivery hashing entrypoints. This is a constrained OS-wide background verification workload, not independently running Adobe/Blender OS subprocesses.

## Milestone 42 — OS-exclusive final delivery receipt + exact-action immutable publication
- The last accepted native delivery receipt is now serialized for both publishing and owner reinspection across Shuvi processes with an OS kernel file handle (Windows zero-share/reparse safe; Unix nonblocking flock). This extends earlier in-process `IO` locking without changing user approval or GUI desktop lease.
- After independent action audit, bounded global slot hashing and Blender certificate verification, production re-reads the durable DAG and rejects publication if objective, revision or exact step states/UUIDs changed while hashing. Same-UUID/step/byte receipt publication is idempotent and preserves the original delivery timestamp. Reusing ANY prior delivered action UUID with altered provenance/task fails closed; a genuinely new owner-approved task with entirely fresh action UUIDs may replace the historical *last receipt* view.
- Added actual real-file OS contention/forged-lock Rust tests, idempotent/mismatched/new-task publication tests, plus Node production contract tests. This is durable final-output correctness, **not** multi-OS subprocess scheduling or Windows creative live acceptance.

### Milestone 42 CI contract correction
- Updated the old SHA-budget source assertion to check `verify_with_pool` and exact Blender certificate verification both occur BEFORE the new kernel-serialized `publish_at`, instead of expecting removed bare `write_at` call. The production verified publish path remains unchanged.

## Milestone 43 — completed native delivery history retained across tasks
- The last completed task retains its existing receipt and verified readback; **before** the next accepted final delivery replaces it, the previous full receipt is stored in `native-task-delivery-history.json` (24 prior receipts, 1 MiB bounded). The existing kernel OS-exclusive last-receipt lock protects archive publication and reads across Shuvi instances. Duplicate UUID/changed provenance, corrupt files and incomplete backup states fail closed. No old worker action is replayed.
- A new read-only Tauri history command and on-demand desktop `Completed tasks` viewer show newest-first metadata plus the current last receipt. `currentlyVerified=false` is fixed intentionally: an archived receipt is NOT a fresh SHA/OS/application proof. Existing `Verify last delivered task` continues to check current file bytes and Rust audits.
- Rust actual-filesystem history retention/replay/corruption tests and Node Rust→Tauri→UI integration contracts accompany this milestone. A crash after last receipt publish but before its archival still leaves the last receipt visible; the next finalization archives it before replacing.

### Milestone 43 frontend IPC parity repair
- Extended the existing explicit UI-native IPC allowlist for read-only `native_task_delivery_history`. Static IPC command matching still refuses unknown or dynamic targets; Rust handler binding remains required.

## Milestone 44 — explicit current-file reinspection of selected completed-task receipts
- The new `native_task_delivery_verify_history` Tauri command accepts ONLY a canonical first-action UUID already found in bounded durable completed-task receipts. Neither the AI model nor UI can submit arbitrary paths, file hashes, tool names or forged success states. The backend rechecks every exact Rust executed/successful audit in that historical task and every CURRENT bounded external artifact SHA256 under one of the same OS-global two hash worker slots.
- Blender outputs additionally require their UUID-bound certificate and approved-plan fingerprint revalidation. Any missing/changed audit or file, corrupt archive, OS-slot contention, or wrong UUID fails closed. The result is clearly marked current **audit/file hash verification**, never Windows creative-quality acceptance, OS process liveness, approval or replay.
- The Completed Tasks UI provides a click-only `Verify files now` control on each archived entry; its default status remains `Not currently verified`. Added direct Rust exact-ID/corrupt-provenance tests, Node command and permissionless-readback wiring contracts and updated explicit IPC allowlist.


## Milestone 45 — independent read-only Windows OS subprocess foundation (NOT yet dispatched)
- Added separate internal native_background_os_workers.rs compiled into the Windows scheduler. Two OS-exclusive process slots across Shuvi instances are independent from single GUI-desktop lease and two Rust SHA256 thread slots. Windows behavioral tests spawn two real, separately PID-owned disposable Windows worker processes and reject a third.
- Each child is created suspended, placed inside its independent Windows Job Object with KILL_ON_JOB_CLOSE and resumed after containment. The existing GUI-worker memory limit remains 4 GiB; read-only worker trees use a stricter 512 MiB commit limit per Job Object. The caller still must provide a host-wide RAM measurement; unavailable/exceeded measurement stops the owned tree.
- A unique action UUID leaves a durable launch_pending intent BEFORE OS spawn, followed by os_running PID and os_*_unverified terminal receipts. Reused UUIDs, corrupt/interrupted records, forged locks, contention, foreign cancellation and ambiguous exits fail closed. Child exit 0 does not claim task success.
- Real Windows Rust tests cover separate PIDs, third-slot denial, exact/foreign Stop, replay denial after released slots, interruption intent, forged slot, host-RAM measurement failure and corresponding Node integration contracts.
- IMPORTANT INTEGRATION BOUNDARY: this primitive is NOT yet the owner-authorized multi-task dispatch path. Production callers must bind owner-approved typed non-GUI jobs, read-only trusted executable, global RAM/CPU quotas, durable per-worker scheduler journal, resource-ownership claims, readback/audit and recovery. No new Tauri IPC, no Adobe/Blender parallel GUI claim and no user's live Windows acceptance. Do NOT label general multi-job execution finished.


## Milestone 46 — durable two-worker read-only OS admission with UUID/PID ownership
- Added native_background_admission.rs as a separate **read-only non-GUI** OS-backed admission ledger. Each claimed input is bound to a canonical existing regular path, canonical action UUID, lowercase expected SHA256 and fixed class read_only_sha256. The ledger has a hard limit of 48 durable entries, at most two simultaneous reserved/running actions, exact duplicate-UUID rejection, held input-conflict rejection, and strict schema/phase validation; old GUI scheduler and its one-running-action rule are unchanged.
- The same ledger uses an exclusive Windows kernel file-handle lock for all reservation, PID registration, terminal transitions and status reads, with forged lock/reparse-point and orphaned/corrupt journal rejection. It persists reserved before any child launch and accepts only exact recorded PID for OS terminal transitions. OS exits remain explicitly **unverified** and do not claim successful app work or SHA result.
- Internal spawn_admitted_readonly now reserves the exact input/UUID BEFORE the M45 owned OS launch and records its real PID after the contained child begins. The child terminal writes the corresponding OS phase and PID into the admission ledger as well as the M45 per-action receipt. A failed launch/record write leaves a durable quarantined claim instead of silently freeing the same UUID.
- The Job Object and global slot teardown were hardened: failed child termination or uncertain durable terminal receipt deliberately retain a kernel slot for this process lifetime rather than risking a third concurrent child. Normal terminal close keeps the child Job Object cleanup ordered before release of the slot.
- Rust Windows behavior tests now exercise two true independent owned PIDs with separate durable claims, exact Stop, a denied third action, failed spawn quarantine, wrong PID, same input and duplicate UUID denial. Separate filesystem unit tests cover cross-instance kernel lock contention, bad receipts/backup, retained crash claim and bounded admission. Added Node source/integration guard script.
- **NOT YET PRODUCTION DISPATCH:** The bridge is still internal and does not accept a model-supplied executable or create a public IPC command. Existing owner-approved prepared-task authorization, trusted allowlisted worker executable, actual SHA readback/output proof, CPU/host-global memory budget and app-side live progress must all be wired before any live user task may use the lane. Read-only input expected hash in admission is an identity **claim**, not actual hash verification. This milestone must NOT be called a complete general-purpose parallel job runner or Windows-owner live tested.


## Milestone 47 — fixed-purpose independent OS SHA sidecar, verified host readback and Windows NSIS packaging source
- Added a Windows-only Rust executable target, src-tauri/src/bin/shuvi-readonly-hash-worker.rs. The binary implements ONLY the fixed read-only SHA-256 protocol; its input is bounded to 128 MiB, streamed in 64 KiB chunks, and opened under Windows read-only handle sharing that denies concurrent writers. Exact canonical action UUID and SHA-256 are mandatory, and a matching output filename is enforced. It creates a bounded per-UUID JSON result with create_new and refuses overwrites, hash mismatches, wrong arguments, missing files and post-approval input mutations.
- Added native_background_hash_readback.rs for INDEPENDENT native host SHA-256 verification. A zero OS exit and worker-emitted JSON are expressly not proof. Host checks exact UUID / expected SHA / byte count / source, opens the original file read-only, independently hashes actual bytes and rejects tampering/replacement. Rust tests include matching evidence, changed input, forged action/digest/bytes and missing/invalid evidence.
- Added run_trusted_sha256_with_guard inside internal native_background_os_workers.rs. Only a fixed same-install-directory executable name is used, never an AI- or UI-chosen command. Calls existing M46 durable admission, two Job Object-backed OS slots and host combined-memory guard. On exit 0 plus exact independent Rust readback only, the M46 journal advances from os_exited_unverified to sha256_verified (NOT app success, Adobe success, Blender success or any generic user task success). Failed/unknown executions remain quarantined. Independently verified input may be checked again with a fresh UUID.
- Added scripts/check-native-sha-sidecar.mjs and a Windows GitHub CI step that compiles and EXECUTES the actual Rust SHA worker .exe against real temp fixture data: matching SHA, overwrite/replay refusal, malformed command, wrong digest and post-approval mutation. Added Node source regression contracts.
- Added an installer-only Tauri v2 config override at src-tauri/tauri.sha-sidecar.conf.json with bundle.externalBin, and an explicit npm run build:windows-installer command (preserving normal tauri.conf.json and beforeBuildCommand: npm run build) plus scripts/prepare-native-sha-sidecar.mjs to compile the Windows release sidecar for the exact Rust target triple and place it in src-tauri/binaries/ before NSIS bundling. Built .exe files are .gitignored; GitHub does not receive build artifacts as source.
- This source change does NOT certify a produced NSIS installer, a signed binary, a user's Windows live acceptance, or the integration of this lane into owner-approved public Scheduler/Permissions flow. No external binary path is accepted from a model or Tauri command; the installed executable must be present or the internal process refuses launch.
- Still required: real prepared owner-approval integration, typed task admission in a multi-job scheduler, independent resource and global RAM/CPU admission, durable start/stop UI, crash review and end-to-end installation/live acceptance. Existing exclusive GUI editing lane remains single-owner.

- Important CI isolation correction: the default tauri.conf.json MUST NOT declare the sidecar externalBin because tauri-build then requires a prebuilt executable even in unrelated Rust-only CI. The special Tauri --config JSON-merge overlay is passed ONLY after npm run prepare:sha-sidecar builds the exact Windows target. Standard Rust/Adobe/Web CI remains unchanged and sidecar-free.


## Milestone 48 — bounded dual real-OS SHA supervisors, CPU hard cap, restart-safe current-file inspection
- Existing GUI/native action scheduler, desktop process lease, and Adobe/Blender path remain EXCLUSIVE and unchanged; dual job concurrency is in the separate READ-ONLY OS lane only. No new model/IPC execution command exists.
- The background OS lane now uses OwnedChild::spawn_readonly_capped for both workers. Windows Job Object SetInformationJobObject configures a hard CPU rate of 2500 (25.00% machine CPU cycles) per worker, plus the existing 512 MiB per-process-tree committed memory ceiling and kill-on-close. If the Windows CPU hard-cap cannot be installed BEFORE CreateProcessW, the job never launches. The existing GUI spawn path has no new CPU limit.
- run_internal_readonly_pair now starts two genuine contained subprocess supervisors under independent Rust scoped threads; each independently holds one kernel slot, durable admission claim, PID and SHA readback outcome. Duplicate action UUID/input rejected before launch. Both workers share a separately supplied host-RAM-over-limit observer which must fail closed; it is the trusted caller's responsibility to supply the existing 4 GiB combined RAM guard and check owner permissions for BOTH actions. Neither thread's exit promotes the other's result. Panics are returned as failures with unresolved disk receipts retained.
- Added a cross-process locked detailed admission snapshot, read-only inspect_readonly_health, and exact per-worker journal cross-checking. Recorded running phases are never considered proof of live progress after host restart, and incomplete or inconsistent receipts require owner inspection. Persisted sha256_verified is a historic event ONLY: each status query independently reads and SHA-rehashes CURRENT input bytes; changed/missing files are flagged and never automatically retried, re-approved or marked an app success.
- Rust tests cover malformed same-UUID pairs, two independent host-observer-failure paths, Windows CPU rate structure/bounds, OS journal split-brain, immutable crash-pending claims and tampering of a once-verified SHA input. Node contracts safeguard CPU scheduling before process creation, separate per-worker results, no public IPC, and current-file rehash after restart.
- **Boundary still pending:** No owner-prepared permission has been wired into an application call site because the existing Rust native desktop approval flow is intentionally not bypassed. An approved multi-job user-facing queue, exact Stop in UI, host-wide RAM probe adapter, full end-to-end Windows installation, final task delivery and real app live tests remain outstanding. Any CPU Job Object incompatibility is a FAIL-CLOSED launch error, never a silent quota bypass.


## Milestone 49 — owner-approved SHA pair through actual prepared native action flow
- New strictly typed 'verify_readonly_sha_pair' action is staged via Shuvi's EXISTING prepare_tool/owner-Allow-once/execute_action permission route. This was integrated at the real Rust native execution boundary, not as a standalone public process-launch IPC. Exactly four named fields are allowed: first_path, first_sha256, second_path, second_sha256. Paths must be absolute and distinct, hashes lowercase 64-digit SHA-256, risk is Medium, and the owner is shown both complete file paths and expected digests BEFORE approval. Extraneous fields and different source/input identities are rejected.
- The already-approved parent action UUID deterministically generates two separate canonical child UUIDs (SHA256-domain-separated v4 variant), ensuring that an interrupted/replayed owner action cannot mint two different worker identities to evade the M46 no-replay admission ledger. Both workers use the M48 two-slot, 512MiB/25% CPU Job Object processes, fixed trusted same-installation sidecar, exact read-only input SHA verification and independent host rehash. If either worker fails, the parent action fails; only two valid readbacks yield an audit success. Returned JSON explicitly says applicationVerified=false and desktopMutated=false.
- To preserve Shuvi's existing 4GiB hard ceiling even while the two SHA children run outside the normal managed GUI process set, the approved action's host-memory callback conservatively reserves an extra 1GiB (2 x 512MiB) against the runtime's already observed Shuvi+managed-process bytes. Unavailable host observation fails closed. This callback is sampled throughout both worker waits. Existing single GUI-lease remains held while this ONE approved paired action runs; it does NOT enable a second GUI action.
- Prevents generic execute_tool_with_action_id() from launching this command in an unapproved/non-owner context; only execute_action() after taking a real pending UUID, durable Rust job, and optional task DAG preflight, can dispatch. Outcome integrates with existing Rust audit, worker history and DAG finish. Restart/unresolved traces remain quarantined, not auto-retried.
- Added Node regression checks for strict owner field disclosure, separate deterministic child identities, full 4GiB budget, dual-readback aggregate success and no AI-supplied executable. The exact output is file-digest verification only, NOT a verified Blender/Adobe creative deliverable.
- Remaining before all Shuvi 38 coding signoff: working owner-facing control/catalog and exact background Stop, per-child current progress UI, stronger SHA sidecar identity pinning, multi-job scheduling beyond the single approved PAIR operation, integration of general read-only task classes and final delivery, plus build/Windows acceptance. This milestone does not claim 100% general multi-job execution.
