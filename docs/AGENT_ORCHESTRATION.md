# Agent orchestration

Shuvi's general desktop agent loop is intentionally bounded and permission-first. This layer coordinates model proposals; it does not bypass typed tools, approval gates, Premiere expectations, or operating-system policy.

## Structured plan metadata

For multi-step work, a tool proposal may carry:

```json
{
  "tool": "read_file",
  "arguments": {"path": "C:/project/file.txt"},
  "reason": "inspect current implementation",
  "plan": {
    "objective": "fix the requested project behavior",
    "step": "inspect the current implementation before editing",
    "success_criteria": "the relevant implementation and constraints are visible in tool output"
  }
}
```

Only one tool is proposed at a time. The plan metadata is descriptive context, not authorization. Invalid or oversized legacy descriptive plan metadata is discarded without disabling an otherwise valid typed tool proposal. Optional task-graph metadata follows the stricter fail-closed rules in [TASK_GRAPH.md](TASK_GRAPH.md): malformed graph restrictions block staging rather than disappearing.

Bounds:
- objective: 500 characters
- step: 500 characters
- success criteria: 800 characters
- orchestration context injected into the provider system message: 3000 characters

The first non-empty objective is retained for the task so a later replan cannot silently redefine the task goal.

## Local state machine

The frontend persists orchestration state in session checkpoint schema v2:

- next step
- proposed/executed action count
- consecutive failures
- exact-repeat blocks
- last proposal fingerprint
- last tool/outcome
- recovery mode
- stable objective
- previous plan step and success criteria
- stop reason

Legacy schema-v1 checkpoints are accepted and migrated to v2 with no invented orchestration history.

The hard agent limit remains 8 steps. Resume restores the persisted next step instead of restarting at step 1.

## Failure recovery

After a successful typed tool result:
- consecutive failure count resets;
- recovery mode returns to normal unless a graph step still requires recovery;
- the next provider turn receives the observed result plus updated orchestration context.

After a failed tool result or tool-preparation failure (only actual execution failures increment the failure counter):
- recovery mode becomes `replan_required`;
- the provider is told not to blind retry;
- the actual tool error remains in the hidden tool-result conversation context.

The exact same unsuccessful tool+arguments proposal is blocked locally before permission staging. A second repeated blocked proposal stops the task. Three consecutive actual tool failures also stop the task and require a new user instruction.

Changed arguments or a different typed inspection tool are allowed so the model can recover from an observed error.

A user denial is also treated as a replan signal; the identical denied action cannot simply be proposed again unchanged. Orchestration v5 retains unsuccessful action fingerprints across intervening successes and graph revisions. Runtime graph/coding evidence is bound to the exact Rust-prepared action UUID and correlated Rust audit receipt; an uncorrelated frontend result cannot advance dependency evidence. While a typed `run_project_task` is executing, its exact prepared action UUID is correlated to the managed child PID. Pressing Stop requests cancellation only for that registered action child. Frontend classification awaits the exact cancellation promise for that action ID, so a fast child exit cannot race cancellation confirmation; a confirmed user cancellation is recorded as a denied/replan outcome rather than a consecutive real tool failure. Backend start ordering is race-safe as well: `execute_action` registers the exact active tool while the prepared-action lock is still held, before removing it from pending state. Stop can therefore either deny a still-prepared `run_project_task` or wait a bounded one-second window for that exact active action to publish its managed child PID; unrelated tools/PIDs remain non-cancellable through this path. Non-cancellable actions are not force-killed and stop after their current result returns.

### Manual PowerShell boundary

PowerShell remains available only from the local **Permission Lab** command path. It is intentionally absent from the provider TOOL_PROTOCOL and provider proposal allowlist, and the Rust staging layer rejects PowerShell whenever an active provider context is present. This prevents an AI proposal from bypassing typed file, Git, task-graph, or coding dependency rules through arbitrary shell commands. Manual PowerShell still goes through the normal local approval gate and audit log.

### Session path approvals

Low-risk session approvals for path-bearing tools are **exact-path only**. Shuvi does not expand one approved path to an entire workspace by frontend string prefix because `..` segments, Windows junctions and symlinks can resolve outside the visible workspace path. Broader workspace discovery remains available through typed canonicalized tools, but auto-execution for a path-bearing read requires the exact previously approved normalized path.
### Managed-process registration

A Shuvi-launched application/browser is not allowed to survive a failed tracking registration. If managed-process state cannot be recorded after spawn, Shuvi terminates that exact launched process tree before returning an error. Managed browsers also roll back the managed-root entry and remove their temporary profile if browser-session registration fails, preventing partially registered automation sessions.

A new manual PowerShell preparation cannot replace an unresolved chat permission. If an earlier manual action is still pending, Shuvi first records a real denial for that exact action UUID; only after that succeeds may the replacement action be prepared. This prevents orphaned prepared permissions from accumulating in backend state.

### Prepared action TTL

Rust bounds the unresolved permission store independently of the frontend. At most 16 prepared actions may exist, and staging prunes actions older than 10 minutes. `execute_action` rechecks the exact action UUID age and records an expired action as denied instead of executing it, so stale approvals cannot remain indefinitely executable after a UI crash or orphaned flow.
Only one approved manual PowerShell action may execute at a time. While it is running, Shuvi blocks a second manual preparation and a new chat task from starting; the UI re-enables manual preparation only in the execution `finally` path.

The approved manual shell process tree participates in the same managed RAM accounting as other Shuvi-launched children. A bounded watchdog samples it while the shell is active; crossing the 4 GB hard ceiling stops that exact shell process tree and fails the action closed.

## Permission boundary

Planning never executes a tool.

The order remains:

1. provider returns one allowlisted tool proposal;
2. local orchestrator checks loop/retry safety;
3. Rust `prepare_tool` validates and risk-classifies the proposal;
4. existing session permission or explicit user approval authorizes the prepared action;
5. `execute_action` runs the typed action;
6. the observed result updates orchestration state;
7. only then may the model choose the next action.

High-risk actions do not gain session auto-approval from the orchestration layer.

## Audit and diagnostics

The local audit records bounded orchestration events:

- `orchestration_blocked`
- `orchestration_replan`
- `orchestration_stopped`

These events are best-effort diagnostics only and cannot change a safety decision. Existing diagnostics exports already include recent audit entries. Audit reads are streaming and retain only the requested bounded tail (maximum 200 entries) in memory; exact action-ID receipt lookups stream the full append-only log while retaining only the latest matching entry, so long sessions do not lose valid typed evidence merely because more than 200 later audit events were written; managed process roots are also bound to the OS-reported process start time so a stale PID that exits and is later reused cannot remain valid Shuvi ownership evidence; DevTools browser commands revalidate that same live process identity before using a stored localhost debugging port, and stale browser sessions/profile directories are removed fail-closed; Shuvi no longer loads an entire long-lived `audit.jsonl` before truncating it. Audit writes are serialized and rotate the active log at 8 MB, retaining at most one previous Shuvi audit segment; this bounds long-running local audit disk growth without widening any permission. Temporary screenshots are also bounded: before a new capture, Shuvi prunes only its own `%TEMP%/Shuvi/screenshots/screen-*.png` files so at most 64 recent captures remain. Other temp files are never candidates for this cleanup, and returned screenshot paths remain available within the bounded retention window. Managed-browser session records are dropped when their root process no longer exists; new browser starts prune only inactive Shuvi profile directories, keeping at most 8 stale profiles while never deleting a profile still registered to an active session. Local diagnostics exports are bounded as well: before writing a new `shuvi-diagnostics-*.json`, Shuvi retains only the newest 15 existing owned diagnostics files, so the new export brings the total to at most 16.

## Non-goals

This system does not:
- execute multiple model-selected tools in parallel;
- retry a failed mutation automatically;
- infer that a future plan step succeeded;
- bypass stale-target expectations;
- restore Premiere projects automatically;
- increase the 8-step safety limit;
- turn plan metadata into a new unrestricted command language.

Runtime correctness still requires current-head frontend/Rust execution and, for Premiere behavior, paired-host acceptance evidence. Provider requests are memory-bounded as well: the frontend sends only the most recent bounded context window, and Rust independently rejects more than 120 messages, any message over 256 KB, or aggregate chat content over 2 MB before inserting Shuvi's system/orchestration context. Rust also rejects declared HTTP responses above 8 MB before JSON decoding and refuses assistant/vision text above 256 KB before it is added to persistent chat context. Provider identifiers/models/base URLs are validated again in Rust before chat or vision staging: provider must be known, model is capped at 256 bytes, custom URLs must be HTTP(S) and at most 4096 bytes, and stored API keys are capped at 16 KB with control characters rejected. Chunked responses without a declared length still rely on the HTTP/runtime memory ceiling, so this is not described as a universal streaming body cap. Automatic provider retries are intentionally conservative: only connection-establishment failures and HTTP 429/502/503 are retried. Timeout/request errors plus HTTP 500/504 fail without an automatic duplicate request because the provider may already have accepted the generation. Coding discovery is bounded too: workspace scans cap both total emitted entries and the number loaded from any one directory before sorting, while text search stops after 150 matches, 5,000 visited files, or 10,000 total directory entries (in addition to existing depth/file-size limits). Discovery also canonicalizes the selected root and refuses symlink entries or canonical paths that escape that root, so a workspace link cannot silently turn a scoped scan/search into an external filesystem read. The composer rejects an oversized user message before it is added to visible history or a checkpoint, and provider-window sizing performs a cheap code-unit guard before UTF-8 encoding. Tool-result envelopes are also forced under the same 256 KB provider-message ceiling: oversized stdout/stderr/error strings are progressively compacted for provider context, with a minimal fail-safe receipt if necessary. This does not change the separately bounded local action result shown in the UI.


## Coding workflow dependencies

Coding actions now have local predecessor checks. These checks are deterministic and run before permission staging; they are not model suggestions.

- `replace_text` requires a successful `read_file` for the exact normalized target path. A successful write/replace of that path invalidates the read receipt; `apply_patch` conservatively invalidates all exact-file read receipts because it may touch multiple files.
- Coding-path `write_file` cannot blindly overwrite source/config files: it requires the same exact successful read evidence first. New code files should be created through structured `apply_patch`, keeping repository/status review in the dependency chain. Non-code general text files remain available to the normal desktop workflow.
- `apply_patch` requires a fresh successful `git_status` for the exact repository path after the most recent Shuvi code mutation. A previous mutation cannot reuse an older status snapshot.
- `git_status` and `git_diff` now return a bounded Rust-generated Git identity receipt containing repository root, branch, local HEAD, upstream name and currently known upstream HEAD. Coding evidence records these receipts instead of trusting path-only success.
- `git_diff` reviews the combined tracked delta against `HEAD`, so both already-staged and unstaged tracked changes are visible in the same review evidence. `git_status` expands untracked files individually; if a requested commit file is untracked, Shuvi requires a successful exact `read_file` after the latest mutation before allowing `git_commit`. Ambiguous or over-bounded untracked status evidence fails closed. Persisted untracked lists and model-supplied commit file lists are capped at 64 entries before path normalization, so oversized arrays cannot create unbounded resume or proposal work. `git_commit` requires fresh `git_status` and `git_diff` receipts for the same repository, branch and HEAD after the most recent Shuvi code mutation. Its `expected_head` must exactly equal that reviewed HEAD. The proposal must also name 1..64 exact reviewed relative files. Rust refuses `git add -A`, refuses pre-staged files outside that reviewed list, stages only literal requested file pathspecs, and refuses the commit if local HEAD changed after review.
- Inside `git_commit`, Shuvi checks the reviewed local HEAD, refreshes upstream before staging, verifies the reviewed HEAD again, stages only the reviewed file list, then refreshes upstream a second time and rechecks local HEAD immediately before the actual commit. If the upstream advanced/diverged at either freshness boundary, the commit is refused rather than assuming the earlier review is still current. Repositories without an upstream can still make local commits, but no remote-freshness claim is invented. A successful commit returns the new exact HEAD receipt. `git_push` is stricter: without a configured upstream it refuses the remote write rather than relying on implicit/default push behavior that cannot be freshness-verified.
- `git_push` requires a successful identity-bound `git_commit` for the same repository after the most recent Shuvi code mutation. Its `expected_head` must exactly equal the committed HEAD, Rust rechecks local HEAD, then repeats the upstream fetch/ancestry check immediately before push. A later edit or external local commit cannot silently reuse the previous push evidence.
- A successful commit invalidates pre-commit validation evidence. If successful validation existed for the edit before commit, `git_push` is blocked until `run_project_task` succeeds again on the exact committed HEAD and its Rust Git receipt reports a clean resulting tracked+untracked worktree; this prevents pre-commit evidence or test-created source changes from being silently reused as commit-bound proof. If no validation evidence existed because the project had no applicable task, Shuvi does not invent a pass or fabricate a universal push block. Running `run_project_task` on the committed repository emits the current Git identity; when that HEAD matches the successful commit, the coding phase advances from `validate` to `push_ready`. Push remains a separately permissioned remote write. The npm/cargo process launched by `run_project_task` is registered as a Shuvi-managed child before waiting, so its process tree participates in runtime RAM accounting and is removed from the managed set after exit. While that validation task is running, a bounded watchdog samples Shuvi plus all managed child-process memory; if the 4 GB hard ceiling is crossed, only that Shuvi-launched validation process tree is terminated and the validation result fails closed. This does not grant permission to kill unrelated processes.
- `run_project_task` is tracked as validation evidence. It is strongly preferred after a mutation when an appropriate test/build/lint/typecheck exists, but a missing validation action is not converted into a fabricated pass or a universal hard commit block.

Successful coding actions advance a bounded local phase:

`inspect → edit → validate → review → commit_ready → push_ready → complete`

The phase is shown in the local agent progress indicator and persisted in the orchestration checkpoint. It is guidance and dependency evidence, not proof that source code is correct. After a commit the phase returns to `validate` until a successful project task is observed on that exact committed HEAD; only then does it show `push_ready`.

Only successful tool results update dependency evidence. Failed, denied, blocked, or merely proposed actions do not satisfy a dependency. A new user task starts a fresh dependency state; resume restores the persisted state. Per-path read receipts now carry their orchestration step. Persisted coding step receipts at or beyond `next_step` are discarded, and older checkpoints that lack per-path read steps drop ambiguous file-read evidence whenever any saved mutation marker exists—even when that marker is itself future/stale—rather than inventing freshness. Checkpoint normalization consults only the bounded 12-path inspection list and never enumerates an unbounded `inspection_steps` object from disk. Resume also computes a monotonic step floor from persisted tool-action, recovery and coding receipts; a stale/lowered `next_step` can never rewind the eight-action safety budget. Inconsistent future markers can only consume/stop remaining budget, not grant extra actions. Locally blocked graph steps preserve their bounded block reason across refresh and resume; clearing that state requires an explicit safe replan/reset path.

The dependency graph intentionally stays narrow. It does not require every valid file creation to have a prior read, and it does not infer a test pass from source inspection. This avoids turning a safety layer into an unrestricted workflow language. Remote freshness and exact-file commit staging are enforced inside the existing typed Git write tools, so they do not consume extra model-selected graph steps or weaken the eight-step ceiling.

## Evidence-based task graph and progress engine

See [TASK_GRAPH.md](TASK_GRAPH.md) for the complete protocol, bounds and recovery rules.
Optional graphs now cover the full proposal → dependency → permission → result → evidence →
checkpoint → resume → progress flow. Graph restrictions supplement the coding checks above.

The outer session schema remains v2; the orchestration payload is v5. Older non-graph payloads
load without invented progress. Legacy v3 graph evidence fails closed because it predates
prepared-action UUID binding; legacy v4 graph evidence fails closed because it predates Rust
audit-receipt correlation. A graph running receipt is saved before staging, the exact Rust
pending-action UUID is checkpointed after `prepare_tool` and before approval/execution, and
successful evidence is accepted only after the matching Rust execution audit receipt is read.
Interrupted running steps resume as uncertain failures requiring inspection/replan, while
audit-correlated completed evidence and the next turn are preserved. Text-only provider
replies, cancellation and safety stops cannot erase unfinished graph work.

Graph statuses and completed counts come from local evidence only. Completed specifications
cannot be changed in a replan, failed history cannot be deleted, and a stable objective cannot
be silently replaced. Six additional strict graph audit events are documented in TASK_GRAPH.md.
