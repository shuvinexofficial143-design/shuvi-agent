# Shuvi Batch 05 — Safe action loop identity and evidence-aware UI reinspection
Date: 2026-10-11. Development staging branch only.

## Current problem
The native Master previously compared proposed actions with raw JSON property order. Semantically identical tool actions with keys reordered could evade the duplicate guard. Conversely, a read-only `ui_windows` query repeated *after* a successful UI mutation was permanently blocked, making post-click observation and verification unnecessarily hard.

## Change
- Bounded canonical action fingerprinting sorts object key order recursively while preserving actual tool and selector values. Rejects unbounded, cyclic, non-JSON, or unsafe input. No fuzzy tool/selector matching and no model/provider switching.
- After a **successfully executed Rust tool with matching successful native audit**, an explicit set of known UI-changing actions allows fresh read-only `ui_windows`, `ui_find`, `ui_discover` inspection. It does not forget prior mutation proposals and does not permit repeated inspections without an intervening verified UI-changing tool.
- Continue to block equivalent duplicate actions in the same observed state, even with reordered arguments. No arbitrary six-step limit.
- Master receives bounded loop avoidance guidance, but all actual Windows tools still require a fresh individual `Allow once` and matching audit.

## Tests
New pure unit tests for canonical keys, invalid values, read-only epoch clearing after exact success; native mock integration for ordered-key duplicate rejection and repeated read-only observation after approved, audited UI click.
Exact GitHub CI and actual Windows/Premiere acceptance must be separately verified.

No edit to Rust tooling, main/ui-dashboard branches, PR merge, installer workflows, deployment, external user projects, or paid provider settings. Phase 1 A01/A08/A09/A10/A17/A22/A23/A24 remain open.
