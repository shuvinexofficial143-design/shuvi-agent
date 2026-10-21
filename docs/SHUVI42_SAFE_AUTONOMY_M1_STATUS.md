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
