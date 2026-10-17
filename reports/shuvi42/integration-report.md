# Shuvi 42 Integration Compatibility Report

Generated: 2026-10-17T09:49:24.937Z
Baseline: `origin/phase1/safety-reconciliation-oct9` (99c9e58ef0e43139edfe2d6464f6411be47e1aa0)

## Verification boundary

This report is produced by read-only Git object inspection. It does not check out, merge, execute, deploy, or mutate any feature branch, and it does not claim live Windows, Adobe, or Blender verification.

## Summary

- Branches analyzed: 5
- Changed files inspected: 307
- Shared-file conflicts: 13
- Static risk flags: 13
- Executions: 0
- Live host verification: false

## Shared-file conflicts

- **integrations/blender-worker/shuvi_blender_plan.py** — origin/feature/shuvi38-native-scheduler, origin/feature/shuvi41-blender-worker (shared_file)
- **scripts/native-master-followup.test.mjs** — origin/feature/shuvi37-master-autonomy, origin/feature/shuvi39-windows-vision (shared_file)
- **scripts/native-recovery-journal.test.mjs** — origin/feature/shuvi37-master-autonomy, origin/feature/shuvi39-windows-vision (shared_file)
- **scripts/native-worker-host-status.test.mjs** — origin/feature/shuvi37-master-autonomy, origin/feature/shuvi38-native-scheduler (shared_file)
- **scripts/phase1-a01-ui-ipc-parity.test.mjs** — origin/feature/shuvi37-master-autonomy, origin/feature/shuvi38-native-scheduler (shared_file)
- **scripts/premiere-acceptance-execution.test.mjs** — origin/feature/shuvi37-master-autonomy, origin/feature/shuvi39-windows-vision (shared_file)
- **src-tauri/src/blender_plan_worker.rs** — origin/feature/shuvi38-native-scheduler, origin/feature/shuvi41-blender-worker (shared_file)
- **src-tauri/src/lib.rs** — origin/feature/shuvi37-master-autonomy, origin/feature/shuvi38-native-scheduler, origin/feature/shuvi39-windows-vision, origin/feature/shuvi40-adobe-editing, origin/feature/shuvi41-blender-worker (shared_native_registration_boundary)
- **src-tauri/src/native_recovery.rs** — origin/feature/shuvi37-master-autonomy, origin/feature/shuvi39-windows-vision (shared_file)
- **src/main.ts** — origin/feature/shuvi37-master-autonomy, origin/feature/shuvi38-native-scheduler (shared_file)
- **src/types.ts** — origin/feature/shuvi37-master-autonomy, origin/feature/shuvi38-native-scheduler (shared_file)
- **web-dashboard/src/native-agent.ts** — origin/feature/shuvi37-master-autonomy, origin/feature/shuvi39-windows-vision (shared_file)
- **web-dashboard/src/native-recovery-journal.mjs** — origin/feature/shuvi37-master-autonomy, origin/feature/shuvi39-windows-vision (shared_file)

## Branch findings

### origin/feature/shuvi37-master-autonomy

Changed files: 125
- Risk flags: none
- Duplicate Rust modules: none
- Unregistered Rust commands: none
- Frontend/native IPC mismatches: none
- Permission guard checks: passed

### origin/feature/shuvi38-native-scheduler

Changed files: 61
- Risk flags: none
- Duplicate Rust modules: none
- Unregistered Rust commands: none
- Frontend/native IPC mismatches: none
- Permission guard checks: passed

### origin/feature/shuvi39-windows-vision

Changed files: 53
- Risk flags: none
- Duplicate Rust modules: none
- Unregistered Rust commands: none
- Frontend/native IPC mismatches: none
- Permission guard checks: passed

### origin/feature/shuvi40-adobe-editing

Changed files: 38
- Risk flags: none
- Duplicate Rust modules: none
- Unregistered Rust commands: none
- Frontend/native IPC mismatches: none
- Permission guard checks: passed

### origin/feature/shuvi41-blender-worker

Changed files: 30
- Risk flags: none
- Duplicate Rust modules: none
- Unregistered Rust commands: none
- Frontend/native IPC mismatches: none
- Permission guard checks: passed

## Machine-readable output

The JSON companion contains exact refs, changed-file lists, conflict ownership, static checks, and explicit non-execution markers.
