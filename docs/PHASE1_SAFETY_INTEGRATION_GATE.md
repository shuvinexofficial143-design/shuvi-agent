# Shuvi Phase 1 — Release and safety integration gate
Date: 2026-10-09. Deployment is explicitly forbidden during this phase.

## Immutable baseline
- main: 03b8ee64788b85337cf5ca67114c9118aa3f3c5e
- ui-dashboard: 77adb69bea7c75150afe0c9c7e7cd8ff960abf85
- phase branch: phase1/safety-reconciliation-oct9 (based on ui-dashboard)
- Production alias remains separate and is NOT the phase branch.

## Conflict map grounded in GitHub compare API
- 62 main-only commits / 154 ui-only commits; 76 changed files in main-vs-ui comparison.
- New native modules on main absent on the UI base: animate, character_animator, frame_io, illustrator, photoshop, substance_3d and related bridges/panels.
- Native core src-tauri/src/lib.rs differs heavily (2,853 added and 163 removed lines in GitHub compare main over UI). It is NOT safe to replace this file wholesale: UI includes an independent read-only web_bridge implementation.
- Additional main-only Premiere review/edit deltas require focused conflict reconciliation.
- Shared UI branch modifications must not be rewritten by copying main; Tauri command registrations and permission tools require a reviewed merge.

## Phase 1 exit gates — NOT YET COMPLETE
1. [ ] A01: create isolated unified candidate preserving ALL registered Adobe modules AND authenticated local read-only bridge. Explicitly audit conflict resolution at Rust command registry.
2. [ ] A17: triage UI native root failures: each becomes stale assertion, wrong fixture, missing integration, or true behavioral defect. No tests silently deleted.
3. [ ] A10: eliminate file truncate-before-write for existing file writes. Implement a crash-safe, same-directory staged write preserving path containment, Windows symlink/reparse-point safety, expected bytes identity and recoverable original; fault injection required.
4. [ ] A08: add bounded waits and truthful cancel semantics for generic native actions including UIA and CDP; never infer rollback from abort.
5. [ ] A09: enforce real backend-owned desktop input/project ownership lock (not the browser planning constant), with cancellation and concurrency tests.
6. [x] A21: read-only local web bridge header reads now have a *total* 3-second deadline rather than repeated per-read timeouts, with a slow-drip socket regression test.
7. [ ] A22: explicit native provider output/request spend gate before actual paid model calls.
8. [ ] A23/A24: patched audited dependency graph; application lockfiles, deterministic installs.
9. [ ] All native source/test suites pass on the EXACT unified candidate, including Rust compile/test on Windows and safe loopback fault tests.
10. [ ] Real Windows/Adobe acceptance evidence gathered later. Code/mocked CI alone is not host certification.
11. [ ] Explicit user approval for FINAL production deployment; none during phase fixes.

## Deployment guard
- Vercel project previewDeploymentsDisabled=true requested/applied before phase branch was created; verified production branch unchanged.
- No merges to ui-dashboard or main during Phase 1; source changes only in staging branch.
- Do NOT redeploy, alter AI providers or touch user Adobe projects.

## Priority
A10 atomic write and A08 cancellation before any destructive Windows acceptance;
A01 baseline before per-module integration; A09 before real parallel workers;
A17 exact candidate test review before installer/host acceptance.
