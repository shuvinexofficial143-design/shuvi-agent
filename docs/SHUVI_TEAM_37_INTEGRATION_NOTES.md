# SHUVI 37 — Integration Notes (Master AI / task-scoped preflight)

Branch: feature/shuvi37-master-autonomy
Frozen base: 99c9e58ef0e43139edfe2d6464f6411be47e1aa0
Scope: source-only; LIVE WINDOWS UNVERIFIED.

## Verified audit findings at frozen base

- The installed native dashboard \`web-dashboard/src/native-agent.ts\` sent model proposals to \`prepare_tool\` at first turn and after an audited native action, but neither path had a locally deterministic, original-brief editor-scope check before native preparation.
- The same dashboard had no active Rust-reconciled task-DAG state even though the other desktop UI has \`src/task-graph.mjs\`, \`src/agent-orchestrator.ts\`, and Rust \`native_scheduler.rs\`. Accepting model-authored graph/step IDs from this dashboard would be an unsound authority boundary.
- Native \`Allow once\`, Rust execution receipts, bounded model requests and restart recovery already exist. This team did not create another native executor, ledger, grant, or auto-approval path.
- The Master continuation after an exact successful audit deliberately requests one next model proposal; an app launch/window inspection is not the full project/save/export goal.

## Changed files and explicit shared wiring overlap

1. \`src/master-autonomy-contract.mjs\` (new, isolated): deterministic Hindi/Roman/English editor + outcome classifier; safe read-only \`premiere_launch -> ui_windows\` blueprint, for guidance only; strict preflight admission of model proposals; unchanged original objective; reject untracked model DAG IDs, cross-editor native tools and contradictory app executable paths.
2. \`web-dashboard/src/native-agent.ts\` (shared Master orchestration only): one new import at module top; \`masterAutonomyGuidance(task.objective)\` prepended to \`continueAfterVerifiedAction\` orchestration context; \`admitDashboardMasterProposal(task.objective,response.tool_proposal)\` inserted *before* action fingerprint and \`prepare_tool\`; the same guidance and hard check inserted into the initial \`send\` path before \`prepare_tool\`. No changes to Tauri IPC tool names, Rust approvals, callbacks, or execution.
3. \`scripts/master-autonomy-contract.test.mjs\` (new): language recognition, two distinct typed DAG readback steps, no project/export false-completion claim, app-scope filtering, model-authored graph rejection, immutable brief, invalid/circular payload, source-wiring regression.

## Contracts for the other teams

- **38 Rust Scheduler**: remains authoritative for prepared UUID, immutable DAG identity, execution lease and grant enforcement. \`initialMasterInspectionDAG\` is **only a UI/planning hint**, not submitted as a scheduler checkpoint. A future real task-scoped grant requires a new explicitly validated Rust API with owner-visible tool/app/path/action/time bounds and revocation.
- **39 Vision**: \`ui_windows\` is an independently audited fresh observation. Window detection does not prove a Premiere project/save/edit exists.
- **40 Premiere/After Effects**: provide an audited typed project identity/save-location and file artifact receipt before the Master may prove project/save/export outcomes. Merely launching Adobe or calling \`premiere_context\` is insufficient.
- **41 Blender**: this gate never invents \`blender_launch\` (not source-verified). Existing Blender worker model/run rules and native artifact hashes remain unchanged.

## Still missing (do not label completed)

- A deterministic general full-goal planner that binds all worker DAG steps to original task ID, permitted app/path/resources and required output evidence.
- Rust-side, revocable task-grant enforcement; existing per-action Allow once remains mandatory.
- Native scheduler integrated across both UI surfaces with verified, bounded autonomous resume; safe uncertain-outcome reconciliation.
- Project creation, actual edit/export, real Windows tool execution, and independent final artifact acceptance have **not** been live tested by this team.

No merge, deployment, installer, native action, production data, or cross-team branch mutation was performed.
