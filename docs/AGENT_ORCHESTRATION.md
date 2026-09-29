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

A user denial is also treated as a replan signal; the identical denied action cannot simply be proposed again unchanged. Orchestration v5 retains unsuccessful action fingerprints across intervening successes and graph revisions. Runtime graph/coding evidence is bound to the exact Rust-prepared action UUID and correlated Rust audit receipt; an uncorrelated frontend result cannot advance dependency evidence.

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

These events are best-effort diagnostics only and cannot change a safety decision. Existing diagnostics exports already include recent audit entries.

## Non-goals

This system does not:
- execute multiple model-selected tools in parallel;
- retry a failed mutation automatically;
- infer that a future plan step succeeded;
- bypass stale-target expectations;
- restore Premiere projects automatically;
- increase the 8-step safety limit;
- turn plan metadata into a new unrestricted command language.

Runtime correctness still requires current-head frontend/Rust execution and, for Premiere behavior, paired-host acceptance evidence.


## Coding workflow dependencies

Coding actions now have local predecessor checks. These checks are deterministic and run before permission staging; they are not model suggestions.

- `replace_text` requires a successful `read_file` for the exact normalized target path. A successful write/replace of that path invalidates the read receipt; `apply_patch` conservatively invalidates all exact-file read receipts because it may touch multiple files.
- `apply_patch` requires a fresh successful `git_status` for the exact repository path after the most recent Shuvi code mutation. A previous mutation cannot reuse an older status snapshot.
- `git_status` and `git_diff` now return a bounded Rust-generated Git identity receipt containing repository root, branch, local HEAD, upstream name and currently known upstream HEAD. Coding evidence records these receipts instead of trusting path-only success.
- `git_diff` reviews the combined tracked delta against `HEAD`, so both already-staged and unstaged tracked changes are visible in the same review evidence. `git_commit` requires fresh `git_status` and `git_diff` receipts for the same repository, branch and HEAD after the most recent Shuvi code mutation. Its `expected_head` must exactly equal that reviewed HEAD. The proposal must also name 1..64 exact reviewed relative files. Rust refuses `git add -A`, refuses pre-staged files outside that reviewed list, stages only literal requested file pathspecs, and refuses the commit if local HEAD changed after review.
- Immediately inside `git_commit`, Shuvi resolves the current branch/upstream, fetches the configured remote, and refuses the write if the refreshed upstream is not an ancestor of local `HEAD`. Repositories without an upstream can still make local commits, but no remote-freshness claim is invented. A successful commit returns the new exact HEAD receipt.
- `git_push` requires a successful identity-bound `git_commit` for the same repository after the most recent Shuvi code mutation. Its `expected_head` must exactly equal the committed HEAD, Rust rechecks local HEAD, then repeats the upstream fetch/ancestry check immediately before push. A later edit or external local commit cannot silently reuse the previous push evidence.
- A successful commit invalidates pre-commit validation evidence. Running `run_project_task` on the committed repository emits the current Git identity; when that HEAD matches the successful commit, the coding phase advances from `validate` to `push_ready`. Push is still a separately permissioned remote write; the phase never fabricates a test pass.
- `run_project_task` is tracked as validation evidence. It is strongly preferred after a mutation when an appropriate test/build/lint/typecheck exists, but a missing validation action is not converted into a fabricated pass or a universal hard commit block.

Successful coding actions advance a bounded local phase:

`inspect → edit → validate → review → commit_ready → push_ready → complete`

The phase is shown in the local agent progress indicator and persisted in the orchestration checkpoint. It is guidance and dependency evidence, not proof that source code is correct. After a commit the phase returns to `validate` until a successful project task is observed on that exact committed HEAD; only then does it show `push_ready`.

Only successful tool results update dependency evidence. Failed, denied, blocked, or merely proposed actions do not satisfy a dependency. A new user task starts a fresh dependency state; resume restores the persisted state. Per-path read receipts now carry their orchestration step. Persisted coding step receipts at or beyond `next_step` are discarded, and older checkpoints that lack per-path read steps drop ambiguous file-read evidence whenever any saved mutation marker exists—even when that marker is itself future/stale—rather than inventing freshness. Locally blocked graph steps preserve their bounded block reason across refresh and resume; clearing that state requires an explicit safe replan/reset path.

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
