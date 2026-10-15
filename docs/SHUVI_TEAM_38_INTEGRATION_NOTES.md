# SHUVI 38 — scheduler integration / handoff
Branch: `feature/shuvi38-native-scheduler` at frozen base `99c9e58ef0e43139edfe2d6464f6411be47e1aa0`.

## Real behavior added
- Admit only the earliest dependency-ready queued job in the persistent owner DAG. Readiness is reconstructed from Rust-audited predecessor states after restart; later ready jobs may not starve an older ready job.
- A new objective cannot discard running, outcome-unknown, or unreviewed failed actions. A same-objective initial reset requires fully audited or explicitly reviewed failure outcomes.
- Keep existing action UUID, Rust audit, exclusive Windows desktop lane, and v1 persisted schedule schema unchanged.
- Rust module tests exercise multi-step dispatch, disk-reload ordering, dependency constraints and recovery bypass refusal. Node source-policy regressions add drift protection.

## Team boundary
Only `src-tauri/src/native_scheduler.rs`, `scripts/native-scheduler-dispatch-policy.test.mjs` and this note changed. No shared `lib.rs` overlap, no UI changes and no merges. CI is source-level; no claim of live Windows application editing.

## Remaining
Real supervisor-owned worker process runner with observed PID/tree, app heartbeat/IPC, safe termination, independently guarded background concurrency and complete audited output lineage are NOT implemented. The one-at-a-time native action path remains authoritative. Continue from this branch's real HEAD on the next 'next'.
