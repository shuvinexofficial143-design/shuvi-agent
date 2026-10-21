# Shuvi42 Safe Autonomous Runtime — Milestone 1 status

Baseline: 883892017a2ed96d3a28c87e7f4a7b57e680df63
Branch: feature/shuvi42-combined-runtime

## What this increment changes
- A native-chat Request Stop control is visible immediately next to the chat composer ONLY while a particular approved Windows action is executing.
- The request calls the pre-existing Rust `cancel_running_action` with the exact actively executing action UUID. It never accepts a model-proposed PID, broad process selection or shell command.
- Once an owner requests Stop, later provider planning and next native tool staging are suppressed on the successful-audit continuation path; the last audited Windows action is still recorded correctly. The journal pauses and requires owner review.
- A requested cancellation is reported honestly: it might be accepted, unavailable or uncertain. A Stop request is not proof of process termination or full goal completion.
- Existing Allow once, Rust action receipts, native recovery and task budgets are unchanged.

## Strictly NOT delivered by this increment
- General one-click autonomous task-level mutation scopes. Existing Rust task_read_grant remains exact-argument/read-only. No mutation approval bypass was enabled.
- Automatic process termination for all app/worker kinds. Existing Rust cancellation is only available for its supported owned workers/processes.
- Durable resume across app restart, global provider cost ledger, remote/mobile Stop dispatch, and full Premiere/Blender E2E.
- No user Windows host tests have been run. GitHub CI is not Windows-owner E2E.

## Next safety acceptance gate before broad task autonomy
1. Native Rust-side scope manifest (task UUID, exact app/project/paths, tool allowlist, expiry, max actions, hard cost limit, explicit owner confirmation).
2. Verify prepared action against scope under the existing Rust execution lock; block sensitive operations, expired/revoked scopes, stale HWND/PID, changed documents and unknown outcomes.
3. Ensure Stop revokes scope and stops further scheduling while never lying about termination.
4. Add a per-task ledger and cost reservation; no uncertain paid request replays.
5. Multi-action simulated tests plus real Windows owner acceptance; keep the existing Allow once path as fallback until then.

## Subsequent M1 foundation increment (post-27011a8)
- Rust `native_task_edit_scope.rs` introduces owner-issued **one exact-file/one tool** in-memory scope, restricted to `write_file` and `replace_text`, maximum 4 actions/10 minutes. Parents are canonicalized; path traversals, reparse points and dangerous operation categories remain outside scope. Rust consumes task+scope+action identity under the existing executor/pending lock before worker start.
- Native UI offers an **explicit owner opt-in** button for eligible prepared actions. Existing `Allow once` remains available, and **each later prepared action still awaits human approval**. No blanket autonomous mutation path is enabled.
- Stop requests revoke scopes associated with executing scoped actions, and failed-action recovery refuses staging after owner Stop (including the post-async-prepare race).
- This scope itself authorizes **0 paid provider calls**. Provider-level monetary reservation/ledger, broader project/app manifests, sensitive-action approvals, app/Windows E2E, and true unattended continuation **remain pending**. There is no assertion of Milestone 1 completion.
- Acceptance remains GitHub frontend + Rust + unsigned installer CI distinct from real owner-Windows tests. Tests cover exact path/tool/task/quota/expiry/revoke/duplicate constraints.

## Next M1 security increment — workspace-scoped exact-file manifest
- Exact-file scopes now bind to the **saved owner-selected workspace directory** at grant time and re-check it at native dispatch; switching workspace, editing an outside file, symlink/junction workspace ancestry, or targeting the filesystem root is denied before mutation.
- Reject Windows alternate data streams, device filenames, trailing-dot/space names and UNC/device namespace paths for scope use. Normal single-action `Allow once` remains available; broader project capabilities are not yet authorized.
- Regression tests expanded for cross-workspace mismatch, outside target, unsafe names and legacy read grant compatibility.

## Next M1 file-consistency gate — stale-edit protection
- Rust scope captures a bounded SHA-256 + byte length snapshot of the exact file at issuance and rechecks it immediately before native worker start. A file changed outside Shuvi after approval blocks subsequent scoped mutation.
- After an exact successful native audit, the Rust scope fingerprint advances for the next *separately prepared and owner-reviewed* action. Failures revoke the corresponding editing scope rather than authorizing an unknown replay.
- Snapshot checks do not replace the existing atomic backup/write verification or turn native worker success into original-goal completion. Maximum 2 MiB existing file for scope snapshots; larger files fall back to Allow once.

## M1 Task-bound paid AI request ledger (in development)
- Each Native Dashboard paid Master request carries a fresh request UUID, current task UUID and a monotonically increasing request index. Rust checks the matching authoritative native recovery model_reserved checkpoint before the provider call.
- The bounded append-only native-task-ai-ledger journal reserves each request with fsync before dispatch. Duplicate request IDs, unresolved earlier requests, malformed records or full journal refuse the next paid request.
- Provider-reported usage tokens are observational. Unknown HTTP outcomes never mean zero spend or authorize replay. The actual USD charge remains UNKNOWN without an authoritative price and invoice; **no hard dollar limit** is implemented yet.
- A Dashboard control reads ledger receipts for user review without granting permissions. Ordinary Chat and existing specialist API flows remain independent; editing scopes continue to grant zero paid calls.
- Real Windows E2E is still pending. M1 remains INCOMPLETE.

## M1 Rust ownership gate — exact action and recovery phase
- Owner-issued editing scope now requires a live v2 Rust recovery checkpoint bound to the *same task UUID* and *same prepared action UUID* in `awaiting_approval`. No free-form WebView UUID alone can mint task scope.
- Every scoped file edit is rechecked under the native execution lock against Rust's exact `executing` checkpoint, its task/action identity, staged reservation and deadline before worker begin. Mismatches fail closed.
- Denying the original prepared action revokes the whole scope before first dispatch; revoke/Stop also invalidates its origin and dispatched UUIDs. Legacy `Allow once` and read grants remain distinct.
- Unit tests cover correct/forged task IDs, mismatched action, phase mismatch, TTL and denial-before-dispatch.

## M1 separate owner-approved native task AI request limit
- Owner selects 2,4,8 or 16 **paid model requests per native task**, default 4. This is independent from the Windows action limit. It is **a hard REQUEST-COUNT cap**, NOT a dollar cap or a verified bill.
- New Rust quota is issued only after the task's first fsynced `model_reserved` Recovery Journal snapshot with one request, zero staged actions and matching task UUID.
- The limit is immutable for the same task and enforced by Rust `chat` before the task AI ledger reservation and any provider call. After restart no quota is resurrected. Ordinary Chat remains independent.
- Request count, provider-reported tokens, and dollar-billed amount remain distinct. Full USD spending limit is not yet delivered. Existing `Allow once`, editing scopes and request ledger are preserved.

## Compatibility fix: first paid Chat preflight owns quota issuance
- Removed the extra Rust quota-setup IPC. The first task `chat` request itself supplies the owner-selected request limit, which Rust checks against the exact original `model_reserved` checkpoint, creates immutable in-memory quota and reserves the paid request in one pre-dispatch path.
- Follow-up tickets omit the limit and cannot escalate it. This preserves existing Chat integration transport and avoids a mock-only approval bypass. Hard REQUEST count remains distinct from USD billing.

## M1 quota-bound continuation compatibility and owner-review availability (verified at b15266e; 3/3 CI)
- Multi-stage integration fixtures select an explicit owner paid-request count rather than accidentally interpreting the default 4-call cap as unlimited multi-action authority; a strict test IPC fixture validates first-ticket maxRequests, task UUID, request index, no follow-up escalation and ordered Rust model reservations.
- Quota exhaustion after a verified Windows action now shows the existing owner recovery/review and abandonment controls. It never reports full-goal completion, silently renews the same task quota, or automatically purchases a model request.
- The 20-stage simulated scenario spans **two distinct explicitly owner-submitted tasks**: the first stops after 15 verified native actions plus one billed/unknown 503 request at a 16-request hard limit, and the owner must abandon/review the old scope and reissue the remaining separate task. This is NOT same-task unattended 20-step autonomy, which remains pending broader task authorization.
- Existing Rust action audit, original action identity, separate per-task immutable quota and ordinary Allow once are unchanged. Windows owner-host E2E and actual USD price control remain pending.

## SHUVI 57–58 incremental Rust read-only window scope (current branch)
- **New owner option** in the native composer: grant eight `ui_discover` and/or named `ui_find` inspections for exactly one identified window title, maximum **3 minutes**. Owner's original scope click is mandatory. Subsequent same-window read-only inspections can continue without repeated `Allow once`, but each still receives a different native prepared UUID, durable recovery checkpoint, and Rust execution audit.
- Rust checks task UUID, exact new action UUID, grant UUID, full prepared native action variant, same-window title, expiry, remaining action count and duplicate dispatch under the existing native execution lock before any native worker dispatch. Original native UIA / OS-identity controls remain active.
- Explicit Revoke, Deny, Task Stop and pause/failed continuation remove the renderer authority and request native Rust revocation. A Stop request does not prove worker termination. A failed Rust revoke cannot silently restore a local grant.
- The eighth scoped inspection ends automatic reuse; the ninth action (even read-only) requires normal individual owner approval. Rust independently enforces its maximum; expiry and restart fail closed.
- `ui_click`, `ui_set_value`, `ui_send_keys`, `ui_windows`, app launches, filesystem writes, browser navigation, payment, delete, external messages and credentials are **not** included in this grant. General task-wide mutating permissions remain **pending**; this is a bounded safe functional subset, not completed Milestone 1.
- AI request-count quota (2/4/8/16), actual paid model preflight, action budget (8/24/48) and cost UNKNOWN remain independent. This scope grants **zero** paid AI requests and is **not** a real-money spending cap.
- Tests: Rust unit tests for expiry, target and task mismatch, duplicate action, denial, revocation and eight-action bound; JS source contract tests and native Master integration test for owner grant, auto read-only follow-ups, unscoped tool rejection and ninth-action manual approval.
- CI status belongs to the exact latest head's own GitHub run; prior successful runs do not establish green status for a new commit. Owner's Windows 11 live desktop E2E and professional Premiere/AE/Blender verification remain pending.

## Shuvi 42 same-title HWND/PID generation defense-in-depth (next M1 increment)
- The Rust executor rejects mismatching or missing native UIA root metadata **before** marking a read action verified and before exposing the read payload to the Master AI. Exact HWND + PID + process start ticks from the first owner-approved read are pinned for the grant. Recycled or same-title replacement windows, mixed-identity read batches, malformed/empty observations, unbound successor receipts, and revoked grants fail closed. The originating read still needs native UIA OS attestation and an owner click.
- This check is post-execution readback (within the Rust executor) rather than a pre-read OS race-free handle lock; independent OS safety checks in each read tool are retained. This does **not** turn window-name equality into authorization for writes or clicks, and does not create a USD cost cap.

## Selected-project read-only root inventory (Shuvi 42 M1 increment)
- One explicit owner click may create a task-bound **eight-use maximum, three-minute** in-memory Rust permission for the currently selected and canonicalized project root only. Eligible native prepared tools are `list_directory` and `workspace_scan`; other paths and file-content reads are excluded. The grant authorizes no paid AI calls and no mutations.
- Rust checks owner recovery phase, current selected workspace root, exact task/action/grant UUID, native execution lease, expiry and duplicate dispatch; native project path/root is checked before execution and after successful inspection, before the `executed` audit. Symlink root and out-of-root access fail closed. A Stop, Deny, task rotation or owner Revoke disables native scope reuse; Stop is not proof a worker actually terminated.
- Dashboard shows explicit grant and revoke controls; it spends local authorizations before IPC and cannot auto-dispatch a ninth read. Existing *duplicate tool proposal* protection stops even earlier when the same tool + same selected root repeats. Thus eight is a strict upper bound, not a promise of eight identical inventory scans.
- Project Inventory scope cannot grant `read_file`, `write_file`, code execution, payments, `ui_click` or other sensitive UI actions. All continue to require separate authorization. Underlying model request budget, Rust immutable paid-request limits and unknown actual USD billing remain independent.
- CI and owner Windows E2E must be verified against the exact final branch HEAD; this increment does not claim General Task Mutation Authorization, filesystem content read reuse or Windows owner-host live proof.
