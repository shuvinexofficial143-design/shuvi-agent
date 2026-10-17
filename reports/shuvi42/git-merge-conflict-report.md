# Shuvi 42 Git Three-Way Merge Report

Generated: 2026-10-17T13:38:36.245Z
Baseline: `origin/phase1/safety-reconciliation-oct9` (99c9e58ef0e43139edfe2d6464f6411be47e1aa0)

## Safety boundary

This report uses Git merge-tree object-only analysis. It does not check out, merge, or modify any branch or working-tree file. It is not Windows, Adobe, or Blender live verification.

## Summary

- Branches: 5
- Unique changed files: 312
- Overlapping files: 15
- Genuine Git conflicts: 9
- Compatible overlaps: 6
- Pairwise merge bases match baseline: true

## Genuine conflicts

- **integrations/blender-worker/shuvi_blender_plan.py** — origin/feature/shuvi38-native-scheduler, origin/feature/shuvi41-blender-worker
  Conflicting pairs: origin/feature/shuvi38-native-scheduler + origin/feature/shuvi41-blender-worker
- **scripts/native-master-followup.test.mjs** — origin/feature/shuvi37-master-autonomy, origin/feature/shuvi39-windows-vision
  Conflicting pairs: origin/feature/shuvi37-master-autonomy + origin/feature/shuvi39-windows-vision
- **scripts/native-recovery-journal.test.mjs** — origin/feature/shuvi37-master-autonomy, origin/feature/shuvi39-windows-vision
  Conflicting pairs: origin/feature/shuvi37-master-autonomy + origin/feature/shuvi39-windows-vision
- **scripts/premiere-acceptance-execution.test.mjs** — origin/feature/shuvi37-master-autonomy, origin/feature/shuvi39-windows-vision
  Conflicting pairs: origin/feature/shuvi37-master-autonomy + origin/feature/shuvi39-windows-vision
- **src-tauri/src/lib.rs** — origin/feature/shuvi37-master-autonomy, origin/feature/shuvi38-native-scheduler, origin/feature/shuvi39-windows-vision, origin/feature/shuvi40-adobe-editing, origin/feature/shuvi41-blender-worker
  Conflicting pairs: origin/feature/shuvi37-master-autonomy + origin/feature/shuvi38-native-scheduler; origin/feature/shuvi37-master-autonomy + origin/feature/shuvi39-windows-vision; origin/feature/shuvi38-native-scheduler + origin/feature/shuvi41-blender-worker
- **src-tauri/src/native_recovery.rs** — origin/feature/shuvi37-master-autonomy, origin/feature/shuvi39-windows-vision
  Conflicting pairs: origin/feature/shuvi37-master-autonomy + origin/feature/shuvi39-windows-vision
- **src-tauri/src/native_task_delivery.rs** — origin/feature/shuvi37-master-autonomy, origin/feature/shuvi38-native-scheduler
  Conflicting pairs: origin/feature/shuvi37-master-autonomy + origin/feature/shuvi38-native-scheduler
- **src/main.ts** — origin/feature/shuvi37-master-autonomy, origin/feature/shuvi38-native-scheduler
  Conflicting pairs: origin/feature/shuvi37-master-autonomy + origin/feature/shuvi38-native-scheduler
- **web-dashboard/src/native-recovery-journal.mjs** — origin/feature/shuvi37-master-autonomy, origin/feature/shuvi39-windows-vision
  Conflicting pairs: origin/feature/shuvi37-master-autonomy + origin/feature/shuvi39-windows-vision

## Compatible overlaps

- **.github/workflows/ci.yml** — compatible_divergent_change; origin/feature/shuvi38-native-scheduler, origin/feature/shuvi39-windows-vision
- **scripts/native-worker-host-status.test.mjs** — compatible_divergent_change; origin/feature/shuvi37-master-autonomy, origin/feature/shuvi38-native-scheduler
- **scripts/phase1-a01-ui-ipc-parity.test.mjs** — compatible_divergent_change; origin/feature/shuvi37-master-autonomy, origin/feature/shuvi38-native-scheduler
- **src-tauri/src/blender_plan_worker.rs** — compatible_divergent_change; origin/feature/shuvi38-native-scheduler, origin/feature/shuvi41-blender-worker
- **src/types.ts** — compatible_divergent_change; origin/feature/shuvi37-master-autonomy, origin/feature/shuvi38-native-scheduler
- **web-dashboard/src/native-agent.ts** — compatible_divergent_change; origin/feature/shuvi37-master-autonomy, origin/feature/shuvi39-windows-vision

## Pairwise results

- CONFLICT: origin/feature/shuvi37-master-autonomy + origin/feature/shuvi38-native-scheduler — src-tauri/src/lib.rs, src-tauri/src/native_task_delivery.rs, src/main.ts
- CONFLICT: origin/feature/shuvi37-master-autonomy + origin/feature/shuvi39-windows-vision — scripts/native-master-followup.test.mjs, scripts/native-recovery-journal.test.mjs, scripts/premiere-acceptance-execution.test.mjs, src-tauri/src/lib.rs, src-tauri/src/native_recovery.rs, web-dashboard/src/native-recovery-journal.mjs
- CLEAN: origin/feature/shuvi37-master-autonomy + origin/feature/shuvi40-adobe-editing
- CLEAN: origin/feature/shuvi37-master-autonomy + origin/feature/shuvi41-blender-worker
- CLEAN: origin/feature/shuvi38-native-scheduler + origin/feature/shuvi39-windows-vision
- CLEAN: origin/feature/shuvi38-native-scheduler + origin/feature/shuvi40-adobe-editing
- CONFLICT: origin/feature/shuvi38-native-scheduler + origin/feature/shuvi41-blender-worker — integrations/blender-worker/shuvi_blender_plan.py, src-tauri/src/lib.rs
- CLEAN: origin/feature/shuvi39-windows-vision + origin/feature/shuvi40-adobe-editing
- CLEAN: origin/feature/shuvi39-windows-vision + origin/feature/shuvi41-blender-worker
- CLEAN: origin/feature/shuvi40-adobe-editing + origin/feature/shuvi41-blender-worker
