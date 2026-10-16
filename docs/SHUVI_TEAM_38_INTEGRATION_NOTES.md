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
