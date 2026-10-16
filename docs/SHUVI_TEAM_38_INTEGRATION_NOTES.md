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
