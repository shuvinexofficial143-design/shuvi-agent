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

## Sixth functional milestone — independent native goal acceptance for Premiere opening (16 October 2026)

The user-supplied original goal ("Premiere खोलो") is **not** completed by a process-launch response, a model answer or generic DAG receipts. Team 37 now wires the existing window-observation evidence parser to the full Desktop Master native delivery boundary. This is strictly narrower than creative project/edit/export verification.

New modules:
- \`src/master-goal-window-acceptance.mjs\` and \`.d.mts\`: Accepts one unambiguous positive \`ui_windows\` Windows record only after an exact successful \`execute_action\`/native audit receipt and a typed completed graph step. Requires an OS ProcessName matching Premiere, an exact observed PID and nonzero native window handle; never relies on window-title-only spoofing. Captures immutable task ID, owner objective, audited action UUID and window identity in **volatile memory**.
- On final delivery, compares the original immutable owner goal, native scheduler objective/revision/jobs, all graph step UUID receipts and **Rust-returned** final delivery. Exactly one audited Premiere launcher must precede exactly one audited \`ui_windows\` inspection as a dependency; receipt UUIDs must differ and increase in orchestration order. A mismatched task ID, stale window, conflicting PID/handle, unsupported editor, missing/duplicate native step or model-only evidence fails closed.
- \`src/main.ts\`: invalidates volatile acceptance on task rotation, fresh window inspection and native mutation; captures only after the exact audited native result; checks goal acceptance after native Rust \`finalize_native_task_delivery\` and before owner-visible task-completed messaging. No proof is revived from a recovered WebView checkpoint after crash—re-observation is required.
- \`src/master-autonomy-graph.mjs\`: marks even a simple editor opening as requiring *independent* final acceptance. Until target-app-specific evidence is implemented for another editor, it stays UNVERIFIED. Full project creation, edits and exports still require independent app-state/artifact proof.
- \`scripts/master-goal-window-acceptance.test.mjs\`: happy-path mock native opening with distinct launch+window UUIDs, Rust schedule, and delivery, plus falsified ProcessName/window title, duplicate windows, stale or foreign task, missing dependency, incorrect receipt, unsupported editor and forged native delivery.

**What is proven:** For a **source-tested** simple Premiere-opening goal, Shuvi can conclude only that an independently inspected Premiere window was observed at a particular audited readback, not that it is foreground, editable, initialized with a project or ready for rendering. There is NO claim of real Windows/Adobe runtime test or automatic edit/export. A task without the evidence stops with "ORIGINAL TASK UNVERIFIED" even if native DAG worker steps were all audited.

## Seventh milestone — model-free simple Premiere opening completion, packaged native Dashboard (16 October 2026)

Previous exact HEAD \`33e0807d011713086e52e56336ebb54c969d8e7d\` completed **12/12 GitHub workflows SUCCESS**, including Full CI Node+Rust. This fact does **not** certify subsequent commits or live Windows.

The installed native dashboard had a gap after the new deterministic \`premiere_launch → ui_windows\` readback: even after a unique, positive, exact Rust-audited Premiere OS window observation it would purchase another Master model turn asking what to do next. In narrowly scoped **pure open** requests this is unnecessary and could lead to further unrequested native proposals.

New:
- \`web-dashboard/src/native-opening-completion.mjs\`: strict whole-request classifier for simple English/Roman Hindi/Devanagari Premiere **opening only**, no project/edit/export/additional command. Requires two distinct exact Rust-audited native actions in the same in-memory task, including a dedicated \`premiere_launch\` preceding the most recent \`ui_windows\`. Parses the real OS window inventory to confirm an unambiguous Premiere title, explicit positive matching \`ProcessName\`, native PID and window handle. Name-only/duplicate/ambiguous windows, model claim or mismatched action ID cannot complete the goal.
- \`web-dashboard/src/native-agent.ts\`: after the verified window audit and native dual-store \`audit_verified\`, if narrow opening acceptance succeeds, first saves an additional **paused** recovery checkpoint to BOTH WebView and Rust; only then displays scoped "OPENING VERIFIED at last audited OS inspection." It skips the *extra* paid Master continuation and stages no other Windows action. If terminal checkpoint cannot be saved, reports the issue instead of claiming completion.
- \`web-dashboard/src/native-task-progress.mjs\`: records a **volatile** \`window_verified\` state and a precise "Premiere window opening VERIFIED; project/edit/export NOT verified" task summary. Nothing is restored as restart execution permission, and acted-on checkpoints still require explicit owner recovery acknowledgement before a new independent task.
- \`scripts/native-opening-completion.test.mjs\`: strict original-goal classification, distinct launch/inspection audit identities, OS spoof/ambiguity, stale/duplicated receipts, durable terminal-before-message ordering and scoped status.
- \`scripts/native-master-followup.test.mjs\`: new mock-native integration scenarios with UUID-shaped prepared IDs verify 2 separate owner approvals + exact executed audits, then terminal no-third-provider-call behavior; spoofed observed process never verifies; project goals continue to Master and stay unverified.

**Scope boundary:** This verifies *window existence at the last audited inspection*, not that the app remains open forever, was foregrounded, created a project, edited or exported media. Other editor opening goals are not silently generalized. Model-free terminal does not grant low-risk read reuse or mutate any Rust permission. Full Node/Rust CI for the new head and actual Windows acceptance are still required.

## Eighth milestone — fail-closed Master creative outcomes and compound-goal protection (16 October 2026)

**CI baseline:** previous exact head \`91f9ce331b1bd5b4febba509f0842f3acf5ad8f1\` completed full \`CI\` SUCCESS, Web Dashboard/Control Center, Native Bridge and Adobe workflows SUCCESS; Illustrator workflow was **cancelled** (do not claim 12/12 success). Source CI does not prove native Windows application operations.

### Actual bug found
\`src/main.ts\`'s end-of-task branch had a guard that rejected missing independent acceptance **only when** \`assessMasterGoalDelivery(...).requiresIndependentAcceptance\` was true. An original request with no currently implemented verifier (e.g. general coding/Windows tasks) could therefore reach a success-looking final delivery message and even a remote \`succeeded\` receipt just because all Rust actions were audited. Also a compound request mentioning Premiere ("Open Premiere and WhatsApp") could be mistaken for a narrow opening goal by coarse editor/verb detection.

### Implemented
- \`src/master-final-outcome.mjs\` plus \`.d.mts\` implement a fail-closed **original owner objective** final gate. An exact simple Premiere opening may pass the existing independent verified OS-window + Rust scheduler + final delivery contract. All other goals now require a future *specific* end-goal verifier and are never completed by tool counts or generic delivery alone.
- For Premiere creative tasks it provides distinct missing-proof identities and owner-readable descriptions: \`window\`, \`new_project_identity\`, \`saved_project_location\` (.prproj, absolute path and Rust file-hash attestation), \`observed_edit_effect\` (independent timeline proof) and \`persisted_export_artifact\` (Rust-rehashed final video linked to project). **These are requirements, not claims that unsupported Premiere native proof tools already exist.** The current Rust delivery artifact allowlist does not attest a .prproj file. Team 40 native implementation and explicit integration would be needed.
- \`src/main.ts\`: after Rust native delivery finalization but **before** any original-goal completed message, clearing checkpoint or sending remote \`succeeded\`, evaluates the final outcome. Unsupported/unverified goal remains stopped with retained native delivery and precise proof gaps; no extra model or native replay. Existing opening verifier is retained.
- \`src/master-goal-window-acceptance.mjs\`: also requires the shared **strict full-brief** single-purpose opening classifier. Compound "Open Premiere and WhatsApp", project, file, or editing requests cannot be satisfied by a window screenshot even when the coarse goal classifier sees "Premiere" + "open".
- \`scripts/master-final-outcome.test.mjs\` and extra \`scripts/master-goal-window-acceptance.test.mjs\` tests cover positive simple opening, unsupported Windows/coding/editor tasks, spoofed native delivery, project file, edits, exports, and compound-goal false completion.
- Local isolated pure outcome evaluator was run for project, edit, export, generic task and unsupported app; all were rejected with bounded missing-proof reasons. This is **not** a substitute for exact-head full CI and live Windows validation.

**Safety and ownership:** No change to the Rust scheduler/delivery, no automatic file edit, app operation, installer, live Windows test, deployment, merge or other team's branch. Master can enforce requirements but may not fabricate a native Premiere .prproj receipt until Team 40 has an actual typed, file-hashed project creation verifier.

## Ninth milestone — CI regression repair and proof-aware Master planning (16 October 2026)

On previous exact head \`b89eeb69576d7fea9f6fd01ab25a020ea402dbe1\`, Rust CI, Dashboard CI and other source workflows passed, but Full CI failed **only two Node regression assertions**: a test regex accidentally matched a literal backslash before \`.prproj\` instead of the extension, and an older Desktop test required an obsolete inline "ORIGINAL TASK UNVERIFIED" string after the new centralized \`summarizeMasterMissingProof\` gate. Both assertions are corrected on this feature branch; the underlying fail-closed product behavior is unchanged.

Additional functional improvement:
- \`src/master-final-outcome.mjs\` exports \`masterGoalEvidenceContext(owner)\`, a bounded deterministic proof-obligation checklist derived from the exact immutable original brief. A project request explicitly calls out independent native project identity and Rust-hashed \`.prproj\` receipt; editing must have timeline change evidence and export must have a video artifact tied to the requested project. It tells the model when independent acceptance is *not implemented* and prohibits invented tool capability, paths, action IDs, hashes, or successful output.
- \`src/main.ts\` now appends this proof context to the existing \`delegatedWorkerContext\` at the actual \`chat\` provider dispatch site, *before* the model proposes a step. It does not add a model call, modify grants, bypass the typed worker/Rust scheduler, or trigger any operation.
- \`src/master-final-outcome.d.mts\` and \`scripts/master-final-outcome.test.mjs\` add declarations/regression tests for the model-facing proof obligations and source wiring.

**Important limitation:** Team 37 still does NOT create or verify a live Premiere \`.prproj\` itself; the native Premiere/Adobe team must provide an independently verified, Rust-owned project attestation before project-creation acceptance could be enabled. No Windows live verification, installer, merge or deployment; exact-current-head Full CI remains separately required.

## Tenth milestone — deterministic initial native Premiere opening DAG (16 October 2026)

A simple owner request "Premiere kholo" previously needed a model to invent a complete typed DAG in the full Desktop UI. Without that graph, the existing audited readback successor could not find a dependency-ready \`ui_windows\` step and the independently audited terminal delivery could not verify the opening goal. This team now adds a **real initial task-graph contract** with no new executor:

- \`src/master-opening-blueprint.mjs\` (\`.d.mts\`) attaches exactly \`premiere_launch → ui_windows\` as a revision-1 typed DAG to the model's first native \`premiere_launch\` proposal **only** when the entire original owner request is strictly one simple Premiere-opening instruction, the arguments are empty, no graph/step/recovery has been proposed, and no native task step has yet run. Graph title/purpose/success criteria remain model-neutral; no status/evidence/permission/UUID is inserted.
- \`src/main.ts\` calls this planner in its existing \`stageProposal\` BEFORE strict Master scope check, normal task graph parser and \`prepare_tool\`. Existing WebView/Native Rust owner approval, exact worker lease, UUID binding, audit, persisted scheduler and model-free inspected-window continuation are unchanged. Remote task work is excluded from the shortcut. The chosen Master request must still produce a permitted typed initial launcher.
- \`scripts/master-opening-blueprint.test.mjs\` tests parser acceptance, native worker queue first-ready and dependent pending states, Hindi/Roman/English owner language, denial for project/edit/export/multi-app/PowerShell tasks, malicious model graph/step/recovery and nonempty launcher arguments, and source wiring before \`prepare_tool\`.

**Functional boundary:** Initial DAG generation does NOT launch anything itself and does not bypass owner permission, and Project Creation \`.prproj\` attestation is still not implemented by Team 37. Native Runner/Team 40 must supply actual project identity and independently Rust-hashed saved file evidence. App opening is only independently accepted after the final native OS window observation, Rust audit and durable delivery. Full CI on current SHA remains required; real Windows testing remains UNVERIFIED.

## Eleventh milestone — Team 40's **actual** Premiere project-create evidence contract (16 October 2026)

**Read-only cross-branch research:** Team 40 \`feature/shuvi40-adobe-editing\` (observed SHA \`abbbd49939577dd836068c2d0050d728464814ee\`) already implements the HIGH-risk, owner-approved \`premiere_create_project\` and \`premiere_open_project\` native tools. Its Rust code, UXP host adapter and tests are **not** in the frozen Team 37 branch yet; NO merge or edits were made to Team 40. Existing source modules on Team 40:
- \`src-tauri/src/premiere_project_lifecycle.rs\`: \`assess_create\` requires actual host Project.createProject + initial save, matching GUID/active path and on-disk readback; result \`project_evidence.project_verified\`, \`host_identity_verified\`, \`disk_persistence_verified\`.
- \`src-tauri/src/premiere_project_persistence.rs\`: bounds nonempty .prproj to 256 MiB and computes \`fnv1a64\`, \`size_bytes\`, \`modified_ms\`. **FNV-1a64 is a noncryptographic change fingerprint, not SHA-256!**
- \`integrations/premiere-uxp/project-lifecycle.js\`: returns actual host \`projectGuid/activeGuid\`, \`projectPath/activePath\`, \`initialSaveAccepted\` and \`verificationStatus\`. Host alone has \`persistenceVerified:false\` and \`reopenVerified:false\`.
- Team 40 native \`ActionResult.stdout\`: JSON \`{host,project_evidence,post_state_verified,retry_safe:false}\`, where verified Rust \`project_evidence.disk_fingerprint\` is \`{path,size_bytes,modified_ms,fnv1a64}\`.

**Implemented on Team 37 ONLY:**
- \`src/premiere-project-evidence-candidate.mjs\` and typed \`.d.mts\`: strict, bounded **candidate-only** validator. Called after the exact successful Rust executed action receipt and typed DAG step are correlated. It requires the authorized task UUID, action UUID, the exact \`premiere_create_project\` tool, owner-requested project goal, exact approved Windows .prproj path, independently reported host GUID/active GUID/path identity, initial save, verified Rust disk fingerprint, bounded positive file length and strict 16-hex lower-case FNV. Contradictory host/reopen/edit claims, changed path, fake 64-character hash, malformed JSON, failed native tool, model-only receipt or other task are **rejected**.
- \`src/main.ts\` consumes that validated candidate only from the current task's volatile exact Rust action outcome; clears it on Stop/task rotation or another mutation. If final creative-goal acceptance is missing, it can report the candidate as **diagnostic progress**, but MUST still stop with \`ORIGINAL TASK UNVERIFIED\`. No SHA-256, reopen, editor timeline or exported file success is fabricated, and no permission/execution is authorized by this candidate.
- \`scripts/premiere-project-evidence-candidate.test.mjs\`: positive mock Team 40 native result, negative wrong UUID/foreign owner, spoofed host identity, mismatched approved path, FNV hash misrepresented as SHA-256, disk error, conflicting native state and source integration controls.
- \`src/master-final-outcome.mjs\`: prompt-level proof requirements now clearly demand an **independent cryptographic SHA-256 file-byte receipt**; Team 40's FNV readback by itself is not enough. Existing \`native_task_delivery.rs\` does not yet accept a .prproj delivery artifact, so no final project creation success is enabled.

**Next explicit integration step (owned boundary):** When Team 40 is integrated into a common branch by the designated owner, add a strictly task/UUID/path-bound **Rust SHA-256 .prproj final-delivery artifact** (native task delivery owner coordination required), compare it against the exact live project-create action and Team 40 FNV/host identity, and verify saved-file persistence/reopen as appropriate. Do NOT simply trust a model's \`sha256\` or promote the current FNV fingerprint to a cryptographic attestation. Neither branch's source/mock tests count as live Windows Adobe host acceptance.

## Twelfth milestone — executable Rust SHA-256 inspection of a prior owner-approved .prproj (16 October 2026)

New source, in Team 37 branch ONLY (no merge of Team 40):
- \`src-tauri/src/native_premiere_project_sha.rs\` provides bounded, genuinely file-backed cryptographic SHA-256 plus FNV-1a64 computed from the **same read** of the existing \`.prproj\`, up to 256 MiB, using 64 KiB streaming chunks. It rejects missing, empty, nonregular or symlinked files, Windows reparse points and redirecting parent directories, dot traversal, missing/unreadable metadata and detected modification/length races. No writes or app actions occur.
- \`src-tauri/src/lib.rs\` wires read-only Tauri \`verify_premiere_project_sha256\` behind the **existing** exclusive native worker lease and pending-approval guard. It accepts an exact native action UUID, exact approved project path, expected previous Team 40 FNV-1a64 and byte length. **Rust** checks that the previous audit has tool \`premiere_create_project\`, event \`executed\`, success, and the **exact high-risk prepare detail including the exact project path**, and that the persisted Rust Scheduler has that precise audited action ID/tool. If any match fails, it does not hash an arbitrary file or create an attestation. This command is unusable for project creation on Team 37 alone because Team 40's executable \`premiere_create_project\` remains on another unmerged branch.
- \`ProjectShaReceipt\` contains exact original action UUID, path, file length, SHA-256, FNV-1a64 and explicit \`verifiedFileBytes:true\`, \`reopenVerified:false\`, \`originalGoalVerified:false\`. FNV is used only to link the independent SHA readback to Team 40's previously verified disk fingerprint; it is **never** represented as cryptographically secure.
- \`src/native-project-sha-proof.mjs\` and \`.d.mts\` match the native attestation to the **same** current task-scoped Team 40 candidate UUID/path/FNV/size, then return a volatile nonterminal SHA receipt. \`src/main.ts\` calls the Rust command only after a successful native action and exact executed audit, and checks Stop, task rotation, candidate identity and owner consent again after the asynchronous read. On a failed readback it refuses verification without any automatic mutation retry or paid AI call.
- \`scripts/native-premiere-sha-proof.test.mjs\` and four Rust unit tests cover normal cryptographic hashing, mismatched path/audit, changed bytes, symlink/empty output, foreign UUID, forged SHA/FNV, false original-goal claim and source binding to Tauri + Desktop control flow.

**Precise verification claim:** Rust independent \`sha256\` proves only the bytes that Rust read at that inspection time; a concurrent external writer can theoretically race the filesystem checks. It does NOT by itself prove Adobe can reopen the project, that the opened active project is the expected GUID after restart, timeline/edit semantics, or completed creative goal. The Master final acceptance remains **ORIGINAL PROJECT GOAL UNVERIFIED** pending a separately approved native Premiere open/reopen and exact final Rust task-delivery integration, owned by the designated cross-team merger. This is a source/test milestone, **not a live Windows Premiere acceptance**. Verify the exact latest commit's full CI before claiming it passed.
