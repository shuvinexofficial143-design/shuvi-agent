# SHUVI 60 — Master Bug Register (Development Checkpoint)
**Historical Source:** SHUVI59_ALL_BUGS_MASTER_REPORT_PART01_TO_12.md (read-only Audit); 29 unique bugs. Part 13 and the specifically named ZIP were not available at this review.
**Repository / only writable branch:** `shuvinexofficial143-design/shuvi-agent` / `feature/shuvi42-combined-runtime`
**Parent Verified HEAD:** `82d7d8eeefd292edf623d75e33529a111b2670bb` — CI 40334329657: frontend, rust, installer all PASS.
**This increment:** BUG-007 and BUG-002 fixes and unit regressions; CI status must be rechecked against this new commit. Do NOT infer Windows E2E.
**Registry status definitions:** OPEN → INVESTIGATING → FIXED IN CODE → CI VERIFIED → WINDOWS VERIFIED → CLOSED.

| Bug | Historical Priority | Current Code State | Affected Paths | Regression | CI | Real Windows E2E |
|---|---|---|---|---|---|---|
| BUG-001 | Medium | Historical CI Verified; preserve | `web-dashboard/src/native-human-progress.mjs`, `scripts/native-master-followup.test.mjs` | Existing Hindi progress tests | Historical PASS | Not required for literal assertion; Premiere flow pending |
| BUG-002 | High | FIXED IN CODE (pending new HEAD CI) | `src-tauri/src/lib.rs` UIA resolver, 8 execution callsites | `scripts/shuvi60-bug002-bug007.test.mjs` + existing UIA tests | Pending | PENDING |
| BUG-007 | High / P0 Privacy | FIXED IN CODE (pending new HEAD CI) | `src-tauri/src/lib.rs` browser DOM read | `scripts/shuvi60-bug002-bug007.test.mjs` + existing browser tests | Pending | PENDING |
| BUG-003 | High | NOT REVALIDATED | Native audit outcomes | Pending | Unknown | PENDING |
| BUG-004 | High | NOT REVALIDATED | AI intent routing | Pending | Unknown | PENDING |
| BUG-005 | Medium | FIXED IN CODE (Shuvi62, exact-HEAD CI pending) | Provider errors | Pending | Unknown | PENDING |
| BUG-006 | High | NOT REVALIDATED | Browser continuity | Pending | Unknown | PENDING |
| BUG-008 | High | NOT REVALIDATED | Remote task queue | Pending | Unknown | PENDING |
| BUG-009 | High | NOT REVALIDATED | Mobile/Rust batch schema | Pending | Unknown | PENDING |
| BUG-010 | High | NOT REVALIDATED | Recovery journal | Pending | Unknown | PENDING |
| BUG-011 | Medium | NOT REVALIDATED | Worker state | Pending | Unknown | PENDING |
| BUG-012 | High | NOT REVALIDATED | Premiere export journal | Pending | Unknown | PENDING |
| BUG-013 | Medium | NOT REVALIDATED | Photoshop bridge | Pending | Unknown | PENDING |
| BUG-014 | High / P0 | FIXED IN CODE (Shuvi62, exact-HEAD CI pending) | Basic credential redaction | Pending | Unknown | PENDING |
| BUG-015 | Medium | NOT REVALIDATED | Audit privacy | Pending | Unknown | PENDING |
| BUG-016 | High | FIXED IN CODE (Shuvi62, exact-HEAD CI pending) | `.github/workflows/windows-installer.yml` | Pinned SHA worker parity test pending | Unknown | PENDING |
| BUG-017 | Medium | NOT REVALIDATED | Background SHA jobs | Pending | Unknown | PENDING |
| BUG-018 | High / P0 | NOT REVALIDATED | RAM watchdog | Pending | Unknown | PENDING |
| BUG-019 | Medium | NOT REVALIDATED | Memory polling | Pending | Unknown | PENDING |
| BUG-020 | High / P0 | NOT REVALIDATED | Mobile approval summary | Pending | Unknown | PENDING |
| BUG-021 | Medium | NOT REVALIDATED | Mobile status refresh | Pending | Unknown | PENDING |
| BUG-022 | Medium | NOT REVALIDATED | Remote dashboard copy | Pending | Unknown | PENDING |
| BUG-023 | Medium | NOT REVALIDATED | Readiness API metadata | Pending | Unknown | PENDING |
| BUG-024 | Medium | NOT REVALIDATED | Mobile expiry status | Pending | Unknown | PENDING |
| BUG-025 | High | FIXED IN CODE (Shuvi62, exact-HEAD CI pending) | `.github/workflows/ci.yml`, `scripts/run-attested.mjs` | Dashboard test/CI parity pending | Unknown | PENDING |
| BUG-026 | High / P0 | NOT REVALIDATED | Screenshot overlay privacy | Pending | Unknown | PENDING |
| BUG-027 | Medium | NOT REVALIDATED | Screenshot directory safety | Pending | Unknown | PENDING |
| BUG-028 | High | NOT REVALIDATED | Native paid AI ledger | Pending | Unknown | PENDING |
| BUG-029 | High / P0 | NOT REVALIDATED | Cross-route paid AI budget | Pending | Unknown | PENDING |

**Latest confirmed open from source before this increment:** BUG-002, BUG-007, BUG-016, BUG-025. Historical BUG-001 verified. Remaining historical 24 must not be misreported as closed or live-open without latest source revalidation.

**NEXT priority:** Verify exact-HEAD frontend/rust/NSIS CI and fix failures first; P0 secret leakage `BUG-014`, screenshot privacy `BUG-026`, RAM failsafe `BUG-018`, AI cost guard `BUG-029` in that order depending on evidence. Full autonomous approval remains INCOMPLETE; one-consent mutation limited to exact UIA control and readback only; no 10-day durability claim.

## Shuvi 62 increment (code staged; CI pending)
- BUG-014: redact Authorization header schemes and folded continuation before truncation, across owner-facing error/output/message.
- BUG-005: classify strictly framed 4xx/5xx provider responses, without retries or reducing billing uncertainty.
- BUG-025: add independent dashboard suite to exact-HEAD frontend/full attestation; update its closed-plan tests.
- BUG-016: disable legacy direct NSIS route; manual workflow now uses immutable SHA-pinned build, ephemeral install/uninstall, manifest SHA verification, unsigned-only artifacts.
- Regression files: `web-dashboard/scripts/native-error-redaction.test.mjs`, `web-dashboard/scripts/native-provider-failure.test.mjs`, `scripts/shuvi62-ci-security-gates.test.mjs`, `scripts/run-attested.test.mjs`.
- State is FIXED IN CODE only until exact-HEAD CI results are observed; owner Windows E2E remains PENDING; BUG-002/007 preserve preceding code fix and pending CI status.
