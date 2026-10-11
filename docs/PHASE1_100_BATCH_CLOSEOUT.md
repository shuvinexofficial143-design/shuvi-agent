# Shuvi — 100-batch source-development closeout (2026-10-11)

## Scope and status
- Batches **1–100** have source-level changes and tests committed on `phase1/safety-reconciliation-oct9`.
- The branch is kept separate from `main`; pull request #15 remains **draft and unmerged**, base `ui-dashboard`.
- This milestone is **source development**, not evidence that the complete autonomous Windows/Premiere/Blender workflow works on a real desktop.
- A user's explicit **Allow once** remains required for every native Windows tool action, including read-only recovery; a prepared tool or model text never grants permission.
- No real Windows desktop actions, paid provider retries, application launches, saved projects, exported artifacts or deployment were performed for these batch commits.

## Final batches
95. Cross-check known process name against native window title before using a UI target.
96. Enforce observed-window identity for read-only lookup when an audited inventory exists; stale observations cannot authorize lookup.
97. Reject computed getter properties inside a native tool proposal's canonical JSON arguments.
98. Reject invisible control and direction characters in prepared approval metadata.
99. Require consistent known lifecycle records for exact native audit verification and failed-read recovery.
100. Add combined safety acceptance tests across prepared approval, exact native audit, goal/window evidence, stale UI snapshots, and failed-read recovery.

## Next gates before calling Shuvi production-ready
1. Obtain successful CI for the exact latest SHA: Dashboard build/tests, primary Frontend verification with attestation, Rust native CI and all relevant source workflows. A running workflow is **not a pass**.
2. On the actual authorized Windows host, test explicit Allow once/Deny; verify exact native audit receipts and that a missing/contradictory receipt causes a safe halt.
3. Test common Roman-Hindi and English intents; detect/open Premiere, Blender and other supported apps, then verify window/process identity.
4. Exercise multi-step editing with real controls: new project, import media, timeline manipulation, captions, audio, transitions, render/export, and independent artifact verification. Record task time, failures, recoveries and user permissions.
5. Verify recovery after stale windows, ambiguous selectors, power/network interruptions and model errors. Ensure no blind repeated action, paid retry or duplicated external operation.
6. Review scope/permissions and security of model credentials, native IPC and connected services before any merge, installer distribution or wider access.

**Do not claim 100% runtime readiness from 100 numbered code batches.** Approval to merge/deploy or perform live desktop acceptance remains separate.
