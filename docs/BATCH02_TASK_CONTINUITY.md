# Shuvi Batch 02 — Objective continuity and completion honesty
Date: 2026-10-11. Staging branch `phase1/safety-reconciliation-oct9`.

## Problem
The native Master previously treated an app-selection follow-up as the new task objective. An original request to create a named Premiere project could turn into a generic "Premiere Pro" opening task after the user's clarification. Separately, large UI output preceded the original request in the bounded continuation report and could push the objective out of the model's context.

## Changes
- `resolveMasterObjective` retains the original objective when a short reply answers a prior app-choice question; unrelated fresh commands do not inherit that task. The original user conversation is still transmitted unmodified.
- Both initial native model guidance and post-audit continuation now include the full derived objective. Bounded request text is placed before untrusted readback data.
- Tool-free model claims after a native action display a visible pause and unverified-completion warning rather than presenting an unsupported success as confirmed.
- No change to the provider, tool protocol, Rust permissions, Allow once, action auditing, billing bounds or actual host actions.

## Verification
- New unit coverage for English/Hindi/Hinglish task continuity, bounded text and explicit absence of goal inheritance without clarification.
- Native mock integration: one app-choice question, one staged Premiere launch, one verified execution, and a second separately approved read-only tool with the original project objective preserved.
- Native mock integration: unsupported prose-only claim remains unverified.
- GitHub exact-SHA CI and real Windows/Premiere disposable-project acceptance must be separately checked; not claimed by source tests.

## Unresolved
Task-scoped approvals, autonomous execution, protected branch reconciliation, paid-model accounting, Windows Adobe acceptance and Phase 1 A01/A08/A09/A10/A17/A22/A23/A24 are not completed by this batch. No merge or deployment authorized.
