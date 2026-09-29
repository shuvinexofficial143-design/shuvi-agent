# Evidence-based task graphs

Shuvi's optional task graph coordinates the existing typed, permission-gated agent loop.
It is not a workflow language, a script runner, or evidence of production readiness.

## Proposal format and trust

A model can propose descriptions and dependencies, never execution state or evidence:

```json
{
  "tool": "read_file",
  "arguments": {"path": "C:/project/src/auth.ts"},
  "task_step_id": "inspect",
  "task_graph": {
    "objective": "Fix the requested authentication bug",
    "revision": 1,
    "steps": [
      {
        "step_id": "inspect",
        "title": "Inspect authentication source",
        "purpose": "Read the implementation before changing it",
        "success_criteria": "The exact file is read successfully",
        "expected_tool": "read_file",
        "depends_on": []
      },
      {
        "step_id": "edit",
        "title": "Edit authentication source",
        "purpose": "Apply the requested correction",
        "success_criteria": "The exact replacement succeeds",
        "expected_tool": "replace_text",
        "depends_on": ["inspect"]
      }
    ]
  }
}
```

The complete graph is needed at creation and revision; subsequent proposals can carry only
`task_step_id`. Existing proposals without a graph remain supported. Once a graph exists,
omitting graph metadata never removes its restrictions. An unassociated action is rejected
except for the explicit inspection recovery path below.

The Rust parser forwards these fields as untrusted JSON. Oversized graph metadata becomes
an invalid marker, not an absent graph. Frontend validation rejects invalid shapes, duplicate
IDs/dependencies, unknown predecessors, self-dependencies, cycles, and model-supplied status
or evidence. A malformed graph blocks the associated action before permission staging.
No additional tool is registered. The Rust typed-tool allowlist, argument validation,
risk classification, session scopes, user approval and execution gates remain authoritative.

Required `expected_tool` binds a step to a tool name. The real Rust tool validator remains
responsible for arguments and targets. Descriptive success criteria explain intent; they are
not executable predicates or proof that an arbitrary natural-language goal was achieved.
For validation, specify `run_project_task`; a file read cannot complete a step expecting it.
A test/build step needs an actual successful result with exit code zero.

## Limits

- 1–8 steps; revision 1–8, incremented by exactly one for a changed plan.
- Stable IDs: 1–48 ASCII letters, digits, underscores or hyphens; first character alphanumeric.
- Objective 500, title 100, purpose 300, success criteria 500, tool name 160 characters.
- At most 7 unique predecessors per step; at most 8 explicit recovery IDs.
- Rust graph envelope: 24,000 serialized UTF-8 bytes. Frontend string limits use JS string length.
- At most 8 action evidence entries across a valid checkpoint; no raw stdout/stderr stored.
- Proposal fingerprints retain the existing bounded canonical tool+arguments representation
  (16,384 characters). They exclude plan descriptions and step IDs.
- At most 8 retained unsuccessful fingerprints and 8 action/blocked turns. A replan never
  resets the action counter, repeat circuit breaker, or consecutive-failure counter.
- Provider orchestration context stays within 3,000 characters; audit details within 1,200;
  the existing session checkpoint remains within 2 MiB.

Each graph step represents one typed action. A coding example fits the ceiling as:
read source → edit → run project task → git status → git diff → commit → push.
Status and diff are separate steps. Include push only when the user requested a remote write.
Extra inspection, blocked proposals and recovery consume the same overall turn budget;
a large graph does not promise enough budget for every possible recovery.

## Local state and completion evidence

Statuses are local: pending, ready, running, completed, failed, blocked, skipped.
Skipped is reserved in the checkpoint representation; the provider cannot skip steps and a
skipped predecessor never satisfies a dependency.

Only a pending/ready step whose predecessors have completed evidence can start. A step
blocked on dependencies becomes ready when they genuinely complete. Completed steps cannot
rerun, and the same completed action cannot be disguised under a new step ID.
An explicitly requested inspection recovery can reread a previously inspected target.

Before staging a graph action, Shuvi saves its running receipt and fingerprint.
If saving fails, staging stops. Successful completion requires the local `execute_action`
return value, a matching tool, a successful typed result, and a matching running receipt.
The graph records step ID, tool, fingerprint, success/outcome, evidence source, local
orchestration turn and a fixed short summary. No timestamp is invented and no raw output is
copied into the graph. Preparation errors, denials, exceptions, and failed results cannot
satisfy dependencies. Provider prose and a success flag supplied without a typed result
cannot complete a step.

Failure changes the step to failed and the coordinator to `replan_required`. Three
consecutive actual execution failures retain the existing stop behavior. Preparation
failures and user denials require replanning but do not increment actual execution failures.

Graph checks run before existing coding predecessor checks and Rust `prepare_tool`.
The exact-path read-before-replace, same-repository status-before-patch, fresh status/diff
after mutation before commit, and same-repository commit-before-push checks remain mandatory.
A permissive graph cannot remove them. Graph completion is not permission to commit or push.

## Replanning and recovery

A full next revision may add, replace or redescribe future steps and their dependencies.
The objective is fixed by the first accepted objective/graph. Completed step specifications
and evidence must remain identical. IDs with failed or completed attempt history cannot
disappear. Incompatible history fails closed and requires a new user instruction/reset.
Historical evidence is copied from local state; provider metadata cannot replace it.

A failed step remains failed through ordinary replanning. To reopen it:

1. Propose a different inspection with `task_recovery: true` and no `task_step_id`.
2. Observe its real successful typed result after the failed attempt.
3. Submit the next graph revision with `recover_steps: ["failed_step_id"]` and an associated
   ready step proposal. Prior failed evidence remains attached to the recovered step.

Recovery tools are a closed list: read_file, list_directory, workspace_scan, search_text,
git_status, git_diff, list_processes, ui_find, browser_dom_read, premiere_context,
premiere_timeline and premiere_bridge_status. These still pass ordinary permission checks.
Recovery cannot be a mutation, an arbitrary shell command, or a validation claim.

Exact failed/denied fingerprints remain blocked for the task even after an intervening
success or a step rename. A recovery must change the unsuccessful action or require a new
user instruction. Renaming does not bypass a denied high-risk action, and changed high-risk
actions still require the existing approval flow.

## Checkpoint and resume

The outer session schema remains v2. Its orchestration payload is now v3 and contains graph,
evidence, retained unsuccessful fingerprints and the last successful recovery turn.
Orchestration v1/v2 remains readable with no invented graph or completion history.
A known last unsuccessful legacy fingerprint is retained conservatively.

Resume validates graph structure, evidence bounds, tool/source/outcome consistency, evidence
turns and dependency ordering. It preserves completed evidence and failed states, recalculates
pending/ready states, and restores the next turn. Invalid graph receipts stop the task
instead of silently discarding graph restrictions.

A saved running step has an unknown outcome. Resume converts it to a failed interrupted
receipt, consumes that turn, and retains the fingerprint against automatic retry. It must
be inspected and explicitly recovered; it is never declared successful. A stopped task
stays stopped, including when it contains an interrupted receipt.

Text-only provider replies with unfinished graph work pause and retain the checkpoint and
show the saved-task resume control. Safety stops and user cancellation also retain graph
progress. A new user instruction or explicit discard/reset starts fresh state.
Checkpoints are local receipts, not cryptographically authenticated attestations.

## UI and audit

Agent Progress shows objective, evidence-backed completed/total count, current running/ready
step, coding phase and coordinator state. A collapsible list shows each step's status.
Model strings are rendered through textContent, never injected as task markup.

Six graph audit names extend the existing three orchestration names:
task_graph_created, task_step_completed, task_step_failed, task_dependency_blocked,
task_graph_replanned, task_graph_stopped. Rust enforces this exact allowlist and existing
size limits. Logging is best effort and never changes permission or dependency decisions.

## Verification and non-goals

`scripts/task-graph.test.mjs` runs deterministic tests of the actual JS graph and TS
coordinator, including all 4,096 four-node directed graphs against an independent cycle
oracle. The Node tests require a maintained Node 22 release with stripTypeScriptTypes or
newer; CI already selects Node 22. Structural tests cover frontend staging/persistence
ordering and Rust audit transport where a desktop runtime is unavailable.

This layer does not run steps in parallel, add shell execution, interpret criteria as code,
automatically retry uncertain mutations, restore Premiere projects, or verify Premiere
runtime capabilities. Browser/desktop restart and permission interaction still require
runtime acceptance. Rust compilation/tests and current-head hosted CI must be reported
separately. GitHub jobs with runner_id=0 and empty/null steps are not test execution.
