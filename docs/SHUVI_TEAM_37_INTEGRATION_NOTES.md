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

## First operational improvement: deterministic audited launch readback

For a **pure Premiere-opening task** (English, Roman Hindi or Hindi, with no project/edit/export intent), the packaged native dashboard now:
1. Obtains normal explicit Allow once and exact Rust audit for \`premiere_launch\`.
2. Computes \`nextMasterReadbackProposal(originalObjective, auditedTool)\` after that confirmed success.
3. Stages \`ui_windows\` using the same \`prepare_tool\`, bounded owner action budget, native recovery journal and a **new** Allow once approval.
4. **Does not make a paid Master model request** for this predictable second step; it does not execute the observation itself.
5. For project creation, editing/export, failed/unknown actions or other apps, returns no deterministic proposal and preserves existing fail-closed model/audit flow.

This is a working, narrowly scoped continuation path, **not** a generic task-DAG executor or evidence of a launched app in a real Windows session.

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

## Second milestone — original-goal-bound multi-worker DAG admission (15 October 2026)

New files:
- \`src/master-autonomy-graph.mjs\`: deterministic, non-executing preflight for **the existing** typed DAG. It pins \`task_graph.objective\` to the first 500 UTF-8 bytes of the original local user request, verifies every declared step maps to a supported native worker, enforces one-editor scope even when the later model proposal omits a graph, and makes pure editor-opening tasks read-only/launch-only. Unknown/unsupported/cross-editor steps fail before Rust \`prepare_tool\`.
- \`scripts/master-autonomy-graph.test.mjs\`: local+remote original-brief wiring, checkpoint restoration, model graph forgery, app isolation, 8/24/48 task budgets, Hindi UTF-8 bounds, opening-only mutation escalation, false creative-goal completion refusal.

Shared file edits (exact points):
- \`src/agent-orchestrator.ts\`: \`AgentOrchestrationState.owner_request\` is set **once** at task creation, preserved in checkpoint restoration and shown as a bounded original owner brief at start of Master orchestration context. An invalid restored owner_request closes the task; legacy checkpoints remain explicitly unbound. No graph execution/recovery scheduling was duplicated.
- \`src/types.ts\`: one optional checkpoint field, \`owner_request\`.
- \`src/main.ts\`: two task-creation sites, local \`#chatForm\` and remote admission, now pin the request. \`stageProposal\` rejects a missing unbound brief, out-of-scope tool and forged/unsupported new graph before \`evaluateProposal\`, \`recordProposalStart\`, or native \`prepare_tool\`. Existing task-graph dependency checks, audit, scheduler admission, approvals, and single execution lease are preserved.
- \`src/main.ts\` terminal \`continueAfterOutcome\`: **after** Rust finalization has checked exact audits/hashes, a Premiere/After Effects/Blender goal that requires project/save/edit/export verification no longer closes as a successful completed creative task solely from all-step audits. It stops safely, keeps the task checkpoint, and explicitly labels the full original goal UNVERIFIED. The Rust delivery receipt remains inspectable.

**Intentional conservative behavior:** A creative DAG with only step success is not independent proof that the exact project exists, requested edit is visible or final export is complete. The final acceptance must remain UNVERIFIED until Team 39/40/41 supply typed and independently verifiable app-state/project/export acceptance. The task-scoped, revocable Rust grant is **not implemented**. Per-action approval still applies. This team does not claim true autonomous multi-app editing.

**Compatibility note:** The full Desktop UI now requires a locally pinned original request for new native actions. Legacy recovery checkpoints that lack it are not silently upgraded into new execution authority. More than 2500 characters is not silently truncated into a new authorization; the owner must resubmit a bounded request if necessary. Native objective identity is truncated on a Unicode code point at **500 UTF-8 bytes**, satisfying the existing Rust scheduler bound.

**Required future integration acceptance:** (1) Owner's Hindi Premiere project/save brief is retained as the task identity across crash/restart; (2) a graph with Blender execution under a Premiere-only brief is refused before native prepare; (3) two valid typed audited steps cannot make a project/export goal succeed without independently checked output; (4) Rust task-scoped grants are validated and revocable by Rust and do not bypass per-action approvals before that backend exists.

## Third milestone — Rust-owned bounded read consent (15 October 2026)

Security finding at start: prior exact read grants lived entirely in the frontend's \`task-permission-scope.mjs\`; neither their TTL nor exact key was enforced by the native Rust action executor. The existing normal \`Allow once\` path remains the permission for all non-read and ungranted actions.

**Rust action boundary implemented:**
- \`src-tauri/src/native_task_grant.rs\` new Rust-only grant store. A grant is issued for an already prepared, natively **LOW risk** action in one of twelve exact typed read families. The signature is SHA-256 of canonical Rust-serialized tool and arguments. Limits: 5 minutes, eight uses, 24 concurrent grants, per-task UUID. No wildcard, path prefix, app family, write, export, UI click, PowerShell, model-generated grant, or persistent grant file.
- \`src-tauri/src/lib.rs\` exposes \`issue_task_read_grant\` and \`revoke_task_read_grants\` only inside the native Tauri command router. The exact signed read identity is captured when \`stage_tool\` validates its typed payload/risk, NOT computed from untrusted UI text. \`execute_action\` accepts optional \`grantId/taskId\` for reuse and checks both atomically with the pending action and native scheduler preflight *before* the Rust worker starts. Ungranted owner \`Allow once\` remains supported. The Rust grant table is memory-only and therefore unavailable after restart.
- \`src/main.ts\` allows grant issuance **only** from the owner's explicit \`#chatAllowSession\` button. The first clicked action still uses the ordinary one-time execution path. Subsequent exact low-risk reads pass the native task/grant UUID pair on the existing \`execute_action\` call; a failed/missing grant stops before execution. On owner Stop, Deny, task rotation, browser session reset or checkpoint completion, local read grants are dropped and Rust revocation requested. Remote task approval cannot create a read grant.
- \`scripts/native-task-read-grant.test.mjs\` checks source wiring and forbidden tool scope, plus four Rust unit tests in \`native_task_grant.rs\` exercise exact argument changes, foreign tasks, TTL exhaustion, revocation, and issue limits.

**Boundaries:** This is a **narrow read-only task grant**, NOT a general unattended native mutation grant. It never means Adobe editing/export can automatically run. Manual \`Allow once\` actions do not carry a reusable grant. A full delegated mutation grant would require a separate native owner-approved and tool/path-scoped policy and real Windows safety review.

**Regression fixed:** Last team's \`agent-orchestrator.ts\` missing comma in the Master's context array caused Web Dashboard CI failure (\`TS1005\`). Corrected before this milestone's CI rerun.

**CI requirement:** Do not call this fully verified until both Node frontend tests/typecheck and Windows Rust tests complete on the exact feature-branch commit, and do not call it live Windows verified without real application acceptance.

## Fourth milestone — verified native multi-step readback (15 October 2026)

**Objective:** Keep a preapproved, independently audited **typed DAG** moving through obvious dependency-ready, read-only Windows inspections without paying for another Master/specialist model turn each time. This intentionally does NOT automate native mutation or bypass a single native consent gate.

Changed/new files:
- \`src/master-safe-continuation.mjs\` + matching \`.d.mts\`: pure source-verified candidate planner. Requires the immutable owner-request objective, exact prior UUID-bound successful Rust task evidence, the existing \`workerQueueView/nextWorkerTurn\` admissible lease/resource/dependency calculation, normal recovery mode, no user stop and no remote task. Only \`ui_windows\` or \`list_processes\` with **empty arguments** can be proposed automatically. Missing dependency, invented UUID, denied/failed/outcome-unknown audit, task switch, loop, or attempted mutation yields \`null\` and never executes a tool.
- \`src/main.ts\`: \`continueAfterOutcome\` saves the previous exact native receipt first; if that succeeded and a safe deterministic readback is ready, it checks \`native_worker_status\` for a clear execution lease and \`native_scheduler_status\` against the saved graph, then calls the **existing** \`stageProposal\`. That still validates original owner objective and typed graph, reserves an action step, checkpoints before native preparation, invokes Tauri \`prepare_tool\`, awaits \`Allow once\` or an exact Rust-owned read grant, then demands the exact executed audit. When no supported deterministic readback is ready, the existing paid Master/specialist continuation remains.
- \`scripts/master-safe-continuation.test.mjs\`: mock-native scenario stages \`premiere_launch\` already audited → prepares **unexecuted** \`ui_windows\` → owner-approved audited \`ui_windows\` → prepares **unexecuted** \`list_processes\` → second separate approval/audit → terminal completion decision. Fails closed on missing/fake/duplicate UUID, false typed receipt, unverified graph, busy Rust lease, mutation, remote task, stopping owner, and failure/recovery mode.
- Local isolated execution of 8 pure mock-native scenarios passed. These ARE NOT live Windows tests. GitHub Node/Rust/CI results are independently required before merge or production readiness.

Cross-team boundaries: Team 38 owns native scheduler and worker lease, Team 39 owns UI evidence and window identity, Team 40/41 own Premiere/AE/Blender output acceptance. The planning bridge does not invent output file paths, automate cross-application editing, auto-confirm project completion, create a permission bypass or edit other teams' branches. An opening goal remains UNVERIFIED until application-specific target-window acceptance is available.

**Integration rule:** Do not replace \`prepare_tool\`, \`execute_action\`, \`action_audit_receipt\`, \`assessMasterSchedulerAdmission\`, owner Stop/Revocation or typed graph recovery. One model-free readback requires a verified predecessor receipt and a separately prepared UUID; 2 consecutive readbacks require **2 separate** owner approvals unless an owner-created, Rust-validated exact-read grant is still active.

## Fifth milestone — exact-head CI repair and async readback identity fence (15 October 2026)

Prior exact HEAD \`4783ac23cd4274f7a4c411362a3022eee7beaab3\` achieved:
- **Rust full CI successful** and **Web Dashboard CI successful**, with several Adobe source workflows successful; overall \`CI\` failed **only in frontend tests** (3 known tests): one approval visibility assertion raced asynchronous UI render, and two tests expected an edit-click under a pure Premiere-opening brief now forbidden by the actual safety policy.
- \`scripts/native-master-followup.test.mjs\`: race assertion waits for actual third native approval render. Negative case now explicitly expects the original brief gate to refuse unrequested cross-app click; positive editing case uses a real project-creation brief that *can* be routed to a separately approved click.
- \`src/main.ts\` follow-up readback adds a stale-task guard, capturing live owner permission-scope identity, revocation, cancellation, graph reference and immutable task brief, and checking again after every asynchronous Rust worker-status/scheduler-status IPC before \`stageProposal\`. A Stop/new task/remote takeover cannot cause a previously authorized readback to be staged under the new task identity.
- \`scripts/master-safe-continuation.test.mjs\` now tests the async native status guard location and exact post-await freshness policy.

**CI honesty:** The new exact feature-head needs its own GitHub checks; prior green workflow results are useful evidence but do not automatically apply to a later commit. Neither source/mocked checks nor GitHub CI are real Windows app action tests. No \`main\` merge or installer.
