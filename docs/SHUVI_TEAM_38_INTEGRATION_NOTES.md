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
