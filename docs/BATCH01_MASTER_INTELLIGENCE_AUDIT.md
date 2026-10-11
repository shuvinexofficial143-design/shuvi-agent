# Shuvi Batch 01 — Master goal completion contract (staging only)
Date: 2026-10-11. Branch: `phase1/safety-reconciliation-oct9`.

## Read-only architectural findings
- `web-dashboard/src/native-agent.ts` is the packaged Windows native IPC chat/approval path. It sends one native provider proposal at a time, requires Rust `prepare_tool`, visible Allow once, `execute_action`, and matching audit evidence. Its continuation is NOT an autonomous task-scoped execution loop.
- `src/agent-orchestrator.ts` / `src/main.ts` are an older desktop workflow with an eight-step bound. Do not conflate that with the current native Master continuation, whose tests explicitly reject an arbitrary six-step cutoff.
- `src/task-graph.mjs` binds plan progress to native tool receipts and does not grant authorization. `master-worker-queue.mjs` is not an independent parallel editing pool.
- The approved-window Vision source `src-tauri/src/target_window_capture.rs` exists, but has not been accepted on a real Premiere Windows host. The current implementation briefly foregrounds a window to capture it and may fail closed if Windows refuses focus.
- PR #15 also has open Phase 1 A01/A08/A09/A10/A17/A22/A23/A24 gates. Source/CI evidence is not permission to merge, deploy or modify Adobe projects.

## Batch 01 source improvement
- Add `web-dashboard/src/native-master-goal.mjs`, a small bounded, non-executing completion guide injected on both initial Master task and audited tool continuation.
- The guide requires completion against the **whole user objective**, not simply a detected executable or opened window.
- For Hindi/Hinglish/English Premiere project-creation requests, the guide highlights the actual final deliverable: a new project with exact requested name and independently checked active/saved project identity, without inventing a location or overwriting files.
- Opening-only and export requests have separate evidence criteria. Any unsupported or unknown outcome is reported honestly; it is never silently marked complete.
- This guide does **not** change tool protocols, permissions, native action count, risk policy, model selection, task-scoped approvals or paid API behavior.

## Verification checklist
- [ ] New `web-dashboard/scripts/native-master-goal.test.mjs` tests pass.
- [ ] Existing Web Dashboard UI tests and build pass on exact candidate SHA.
- [ ] Existing native frontend / Windows source CI passes on exact candidate SHA.
- [ ] Real Windows/Premiere disposable-project acceptance remains **pending**; CI never substitutes for that evidence.

## Next work in Batches 2–10
Audit the source-of-truth Task Objective lifecycle, classify outcomes by evidence, define minimal task checkpoint/approval grants with Rust ownership, strengthen cross-language intent evaluation and revise planning only after host-verified failures. Do not add broad autonomous execution before the separate Phase 1 safety gates are resolved.
