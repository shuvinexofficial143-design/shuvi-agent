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

## 2026-10-09 incremental source fixes (do NOT treat as release clearance)
- A08: Git process wrappers now enforce 90-second local and 180-second fetch/push deadlines; stdin is capped at 8 MiB and stdout/stderr is bounded. A hung-child Rust regression is included. Cancel/timeout can leave an **unknown external outcome**; inspect the Git/workspace state before retrying.
- A22 partial: native single-image and multi-frame vision prompts are capped by MAX_CHAT_MESSAGE_BYTES, and Gemini/OpenAI-compatible vision output payloads now carry explicit MAX_PROVIDER_OUTPUT_TOKENS. Existing Anthropic limits remain. **These byte/token bounds are NOT a monetary budget, quota accounting, pricing guard or guarantee against provider billing.** A22 is still OPEN pending a separately enforced request/spend policy and unknown-price rejection.
- Stage-specific GitHub CI must run on the exact candidate SHA after these changes. Last fully completed predecessor: 08ab75f00dbd270ac33f1f5ee8bc6596ade450e7 (frontend + Windows Rust + source workflows passed).
- No Windows/Adobe live acceptance has been performed by these source changes. No Vercel preview, production deployment or protected branch merge is authorized.

## A24 generated lockfile verification (pending exact new CI)
- CI run 37894450545 generated all three locks from real npm and Cargo resolution on Ubuntu: `src-tauri/Cargo.lock`, `web-dashboard/package-lock.json`, `remotion-runtime/package-lock.json`. The two nested npm clean installs passed.
- Lockfiles are committed with this change. Rust attested commands use `--locked`; Web Dashboard and Remotion CI use `npm ci`, never installation-time ad-hoc version resolution.
- These fixes address application install reproducibility, NOT vulnerability/advisory triage, host runtime certification or A23 dependency security audit. A23 remains OPEN; A24 pending exact-commit CI results.

## A22 partial native paid-model attempt circuit breaker
- Native text/vision provider entrypoints reserve a shared atomic slot before sending a metered request, with a conservative 48 attempts per running process. Local loopback Ollama is exempt; remote Ollama, unknown and other providers are metered.
- Paid text model POST requests now have no automatic network or throttling retry; a failed or ambiguous call is not silently duplicated. Frame.io GET retries are unchanged.
- This guard RESETS on process restart and is **NOT a USD/daily/monthly cost budget**. Provider token rates, billable image/video usage, user-approved price limits, persistent ledger and startup reconciliation remain OPEN for A22.

## A23 evidence-based advisory audit (pending CI)
- A read-only Phase 1 GitHub Actions audit will check the three committed npm locks (root, Web Dashboard and Remotion) with npm advisory data, and the committed Cargo.lock using pinned cargo-audit v0.22.2 and RustSec advisories.
- High/critical npm advisories and RustSec vulnerability findings fail the advisory job. Empty, malformed, or unavailable audit reports fail closed; summary and raw JSON artifacts are retained for triage.
- This is a detection workflow, **NOT proof that the dependency graph is patched or vulnerability-free** until the exact job passes and findings are reviewed. Never auto-upgrade a package without affected-feature and build review.

## A09 bridge lifecycle serialization (partial)
- Native approved tool execution, and **all five Adobe bridge start/stop Tauri commands** (Photoshop, Illustrator, Animate, Audition, Premiere) now share the same Rust-owned execution slot.
- Bridge status/read commands stay nonexclusive. Concurrent bridge lifecycle operations fail closed while any native tool owns the slot. Shared slot also has real-thread and unwind regression tests.
- **A09 is not complete:** internal/background workers and application-owned IPC access paths still require entrypoint audit, process ownership verification, and real Windows concurrency tests before parallel agents can safely drive mouse/keyboard.

## A10 byte-verified Windows publication and recovery (pending exact Windows CI)
- After the OS publishes a staged file, native A10 code independently hashes the new target and the same-directory recovery backup and compares those with the intended new bytes and the fingerprint of the original file. Mismatch refuses a success receipt and preserves available evidence as an **uncertain external mutation** requiring manual inspection.
- Existing pre-publish fault injection remains fail-closed. Added safe temporary-directory Rust tests for binary-byte restoration, missing targets, pre-publish failure and symlinked file paths, plus a Windows disposable junction-ancestor test.
- This is not a complete defense against a malicious same-user process racing filesystem paths, and a successful CI on Windows is not proof of durable power-failure recovery. Real Windows/Adobe acceptance remains explicitly pending.

## 2026-10-09 A08 managed process cancellation exit confirmation (pending CI)
- Do not claim a running action was cancelled simply because `taskkill` or `kill` returned success: the native backend captures the original PID/start-time identity, observes process disappearance/identity change for up to one second and only then returns confirmed cancellation.
- The shared managed-process termination command is bounded to 10 seconds with capped stdout/stderr. An unconfirmed termination explicitly reports an unknown outcome, rather than automatically retrying an external action.
- This does NOT prove rollback of file/project mutations or kill every unrelated descendant retaining handles; real Windows acceptance still required.

## A10 new-file publication hardening (pending exact Windows CI)
- Newly created files now write to a unique same-directory staged inode, fsync it, and create a no-overwrite hard link into the final path. Existing files still go through backed-up atomic replacement. Direct truncation and partial new-file publication are disallowed.
- New path ancestors must be real non-reparse directories, including Windows junctions; no silent overwrite of a destination appearing concurrently. If a host/filesystem does not support hard links, file creation fails closed rather than exposing partial bytes.
- Added disposable Rust fixtures and source regression checks. Host-specific Windows permissions, durability after power loss, and same-user symlink races still need live acceptance.

## A01 regression gate — code registry union (CI pending)
- Current isolated candidate retains the union of Tauri commands from native `main` (40) and `ui-dashboard` (29): 43 unique handlers including all five Adobe lifecycle bridges and the web read-only local bridge.
- Rust module declarations similarly retain the declared source module union from both baselines. A new Node regression suite fails if a baseline module or command is dropped or duplicated on the unified candidate.
- This is **registry/source parity**, NOT a completed live merge or runtime acceptance; Phase 1 A01 remains open until the exact release candidate passes Windows/Adobe real integration and authenticated bridge acceptance.

## A09 Windows cross-instance native desktop lease (pending exact Windows CI)
- Native actions and five Adobe bridge start/stop commands now share both the existing process-local atomic guard and a per-Windows-user exclusive File handle (`%LOCALAPPDATA%/Shuvi/native-desktop-action-v1.lock`). A second Shuvi process in the same Windows user profile fails closed while the first owns the lease.
- The exclusive handle is thread-migration safe, unlike an OS mutex held by a thread across async Rust awaits. Guard drop releases the Windows handle before releasing the atomic slot. Windows Rust tests exercise independent per-instance atomics and repeated conflict/recovery; the lease folder and target reject junction/reparse points.
- A09 remains OPEN: this excludes **multiple Shuvi instances under the same Windows user profile**, not independent other desktop-control programs or every Adobe/IPC side channel. OS ownership and live Windows acceptance must be confirmed on the exact candidate.

## A22 durable Windows daily paid-attempt journal (source staged; exact CI pending)
- Native metered text/vision calls now reserve against BOTH the 48-attempt runtime limit and a **48-attempt UTC-day append-only journal** in `%LOCALAPPDATA%/Shuvi/paid-ai-attempts-utc-<day>.log` before calling provider HTTP.
- Daily append events use a 2-byte verified format, bounded reads, Windows exclusive cross-instance file ownership and `sync_all`; an inaccessible, partial, tampered, or saturated journal fails closed. It prevents an ordinary application restart from resetting the daily attempt allowance.
- This is still NOT a verified dollar/rupee spend budget. The Windows system clock, per-user local files, external concurrent usage, provider prices, token billing and remote APIs are not reconciled. Persisted attempt quotas are an interim protection; **A22 remains OPEN** until user-approved monetary ceilings, pricing validation and provider-side usage reconciliation exist.

## A01 / A17 UI-to-native command contract (pending exact candidate CI)
- Checked the current local desktop UI `src/main.ts`: 33 statically named `invoke` sites, 24 unique commands. Added a regression gate that maps Rust `generate_handler!` entries to unqualified Tauri command aliases (including `web_bridge::web_bridge_start`/stop) and fails on dynamic or missing UI IPC command targets.
- Explicit action preparation, execution, cancellation, denial and audit-receipt commands remain required; native execution slot is still the authority.
- This is contract/source consistency, **not** proof that the full Windows packaged UI works correctly. A01/A17 remain OPEN until compiled Windows/Adobe live acceptance.

## Priority
A10 atomic write and A08 cancellation before any destructive Windows acceptance;
A01 baseline before per-module integration; A09 before real parallel workers;
A17 exact candidate test review before installer/host acceptance.
