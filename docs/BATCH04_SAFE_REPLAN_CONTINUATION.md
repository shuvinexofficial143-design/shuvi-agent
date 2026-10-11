# Shuvi Batch 04 continuation — fail-safe recovery planning (11 October 2026)

Branch: `phase1/safety-reconciliation-oct9` (staging only).

## Exact commit test failure diagnosed
The previous 20717612 frontend suite had a stale assertion in `scripts/native-windows-ui-grounding.test.mjs` expecting the failed-receipt check to remain in `native-agent.ts`. Since the production receipt predicate moved into `native-read-recovery.mjs`, the audit safety logic had not been deleted. The test now checks the extracted policy **and** verifies its invocation in Native Master.

## Bounded safe-replan improvement
A definitively failed `ui_find` or `ui_discover` may stage `ui_windows` only with its exact unsuccessful native audit receipt and a new owner approval. A temporary, non-executable `recoveryFrom` marker then lets the Master distinguish successful recovery-window observation from successful completion of the original action.

After that separate approved read-only window observation succeeds, the existing one-per-step Master continuation receives explicit instructions to use uniquely grounded window/process identity and, where useful, request a *separately approved* `ui_discover` inspection. It must never guess a similarly named button, click automatically, loop on the same failed selector, or claim task completion based solely on window visibility.

No new paid provider calls are made by the recovery failure itself. No tool auto-execution or permissions change. All original Batches 1–3 and latest Batch 4 behavior remain preserved. The marker is ephemeral and cleared for the next staged Master action. No arbitrary six-step cap introduced.

### Verification boundaries
New policy tests and native mock approval/observation/replan test included. Exact-commit CI and actual Windows/Premiere disposable project acceptance are separate. No installer, merge, deployment, or external project modifications. Phase 1 A01/A08/A09/A10/A17/A22/A23/A24 remain independently open.
