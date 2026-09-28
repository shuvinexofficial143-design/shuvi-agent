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

Only one tool is proposed at a time. The plan metadata is descriptive context, not authorization. Invalid or oversized plan metadata is discarded without disabling an otherwise valid typed tool proposal.

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

After a successful tool result:
- consecutive failure count resets;
- recovery mode returns to normal;
- the next provider turn receives the observed result plus updated orchestration context.

After a failed tool result or tool-preparation failure:
- recovery mode becomes `replan_required`;
- the provider is told not to blind retry;
- the actual tool error remains in the hidden tool-result conversation context.

The exact same unsuccessful tool+arguments proposal is blocked locally before permission staging. A second repeated blocked proposal stops the task. Three consecutive actual tool failures also stop the task and require a new user instruction.

Changed arguments or a different typed inspection tool are allowed so the model can recover from an observed error.

A user denial is also treated as a replan signal; the identical denied action cannot simply be proposed again unchanged.

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
