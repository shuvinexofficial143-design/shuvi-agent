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
