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
| BUG-015 | Medium | FIXED IN CODE (Increment 03; CI pending) | Audit privacy | Pending | Unknown | PENDING |
| BUG-016 | High | FIXED IN CODE (Shuvi62, exact-HEAD CI pending) | `.github/workflows/windows-installer.yml` | Pinned SHA worker parity test pending | Unknown | PENDING |
| BUG-017 | Medium | NOT REVALIDATED | Background SHA jobs | Pending | Unknown | PENDING |
| BUG-018 | High / P0 | FIXED IN CODE (Increment 02; CI pending) | RAM watchdog | Pending | Unknown | PENDING |
| BUG-019 | Medium | NOT REVALIDATED | Memory polling | Pending | Unknown | PENDING |
| BUG-020 | High / P0 | FIXED IN CODE (Increment 05; CI & mobile E2E pending) | Mobile approval summary | Pending | Unknown | PENDING |
| BUG-021 | Medium | FIXED IN CODE (Increment 06; new CI pending) | Mobile status refresh | Pending | Unknown | PENDING |
| BUG-022 | Medium | FIXED IN CODE (Increment 06; new CI pending) | Remote dashboard copy | Pending | Unknown | PENDING |
| BUG-023 | Medium | FIXED IN CODE (Increment 06; new CI pending) | Readiness API metadata | Pending | Unknown | PENDING |
| BUG-024 | Medium | FIXED IN CODE (Increment 06; new CI pending) | Mobile expiry status | Pending | Unknown | PENDING |
| BUG-025 | High | FIXED IN CODE (Shuvi62, exact-HEAD CI pending) | `.github/workflows/ci.yml`, `scripts/run-attested.mjs` | Dashboard test/CI parity pending | Unknown | PENDING |
| BUG-026 | High / P0 | MITIGATED IN CODE (Increment 03; not closed, CI/Windows pending) | Screenshot overlay privacy | Pending | Unknown | PENDING |
| BUG-027 | Medium | FIXED IN CODE (Increment 02; CI pending) | Screenshot directory safety | Pending | Unknown | PENDING |
| BUG-028 | High | NOT REVALIDATED | Native paid AI ledger | Pending | Unknown | PENDING |
| BUG-029 | High / P0 | FIXED IN CODE (single-call cross-route; multi-call blocked; CI/Windows pending) | Cross-route paid AI budget | Pending | Unknown | PENDING |

**Latest confirmed open from source before this increment:** BUG-002, BUG-007, BUG-016, BUG-025. Historical BUG-001 verified. Remaining historical 24 must not be misreported as closed or live-open without latest source revalidation.

**NEXT priority:** Verify exact-HEAD frontend/rust/NSIS CI and fix failures first; P0 secret leakage `BUG-014`, screenshot privacy `BUG-026`, RAM failsafe `BUG-018`, AI cost guard `BUG-029` in that order depending on evidence. Full autonomous approval remains INCOMPLETE; one-consent mutation limited to exact UIA control and readback only; no 10-day durability claim.

## Shuvi 62 increment (code staged; CI pending)
- BUG-014: redact Authorization header schemes and folded continuation before truncation, across owner-facing error/output/message.
- BUG-005: classify strictly framed 4xx/5xx provider responses, without retries or reducing billing uncertainty.
- BUG-025: add independent dashboard suite to exact-HEAD frontend/full attestation; update its closed-plan tests.
- BUG-016: disable legacy direct NSIS route; manual workflow now uses immutable SHA-pinned build, ephemeral install/uninstall, manifest SHA verification, unsigned-only artifacts.
- Regression files: `web-dashboard/scripts/native-error-redaction.test.mjs`, `web-dashboard/scripts/native-provider-failure.test.mjs`, `scripts/shuvi62-ci-security-gates.test.mjs`, `scripts/run-attested.test.mjs`.
- State is FIXED IN CODE only until exact-HEAD CI results are observed; owner Windows E2E remains PENDING; BUG-002/007 preserve preceding code fix and pending CI status.

## Shuvi 62 Increment 02 (2026-10-27)
- Prior HEAD 3ac5d57 exact CI 40344509868: Frontend/Rust/Windows Installer all PASS. BUG-002/005/007/014/016/025 remain pending real-owner Windows acceptance, not falsely closed.
- BUG-018: Remotion, project validation and manual shell now detect RAM sampler/registered identity errors, attempt identity-checked termination, mark result not successful even after exit 0; resource abort may be unconfirmed and must be reported truthfully. No unverified process kill claims.
- BUG-027: screen-* manual captures use the same validated non-reparse Shuvi screenshot directory as ephemeral vision; path rechecked after helper. Residual TOCTOU and owner Windows testing remain.
- BUG-026 (foreign overlay capture) and BUG-029 (cross-route AI cost) remain P0 OPEN for further safe resolution.

## Shuvi 62 Increment 03 (2026-10-27)
- BUG-026: Screen-copy now checks all overlapping visible top-level windows above the exact target HWND (bounded 4096) before/after CopyFromScreen and after PNG save, in addition to existing 5 sample/PID/process generation checks. Static small overlay missed by old sample points now triggers refusal. **No absolute pixel provenance/OS compositor or owner Windows E2E proof**: preserve OPEN (MITIGATED) status; transient overlays and exotic compositor surfaces require real Windows testing.
- BUG-015: search_text literal query and exact workspace path omitted from persisted audit, regardless of whether a secret looks like a token. Prepared in-memory consent retains original detail.
- BUG-029: confirmed existing native task paid-request boundary is chat-only; separate Vision/Creative billable calls are not counted in owner selected task quota. **Still OPEN** pending Rust authoritative cross-route reservation, no false spending safety claim.
- Latest previous CI 40452821089 (8bcb1fc) was Frontend PASS, Rust and NSIS running at start of increment. Exact newer CI pending.

## Shuvi 62 Increment 04 (2026-10-27)
- BUG-029 code: Rust task-bound `inspect_screen`, single-call motion generation/correction/review and Premiere frame inspection now reserve original owner quota + durable per-request ledger under exact action UUID, before provider call. Uses same 2/4/8/16 quota and 256 KiB prompt cap; no automatic replay. Task multi-frame/finishing review remains fail-closed until per-call metering. Manual separately owner-approved non-task tools are independent.
- Frontend verifies exact action UUID/task ID/index ledger receipt then spends one local native model request before recovery can advance; unknown receipt halts. Provider token usage/verified dollar caps are *not* claimed. Exact new CI and real owner Windows tests PENDING.
- Prior HEAD 505e315 exact CI 40453995626 had Frontend PASS, Rust/Installer IN PROGRESS at beginning of this increment. Do not infer full CI success.

## Shuvi 62 Increment 05 (2026-10-27)
- BUG-020: Authenticated native agent must publish bounded Rust-prepared action disclosure (UUID, kind, risk, summary, specific target) in requires_approval receipt. Mobile renders exact fields as text before Approve once. Server validates full disclosure; decision binds exact action UUID, task, approval, owner/device, expiry and replay. Windows consumer matches exact action UUID before executing.
- Missing/malformed data or unrepresentable target refuses mobile approval. PowerShell command bodies are not sent to cloud and cannot be mobile-approved under this contract; use local permission UI.
- Prior d626a9cd exact CI 40455539267: Frontend/Rust PASS; Windows Installer in progress when checked. New exact-head CI/owner-phone Windows E2E unverified. BUG-029 multi-call metering still pending.

## Shuvi62 Increment 06 (2026-10-27)
- Base HEAD d62de7ed1ae8b0f9f62c4a91724e5b07da4a63e7 Run 40458275042: exact Frontend/Rust/Installer all SUCCESS (verified).
- BUG-021 mobile browser client: authenticated status polling every 4.5s visible, 20s hidden, capped exponential backoff, visibility resume; session-epoch guard and abort in-flight GET requests at disconnect. No Windows actions or model requests from status poll.
- BUG-024 server now derives `expired_not_delivered` in authenticated describe/list while preserving immutable native `received` receipt; mobile renders expiry without offering phantom Stop; agent still never polls expired messages; a legitimately admitted late task remains eligible for stop.
- BUG-023: source-implemented cloud queue, CAS, authenticated outbound relay report `source_implemented_configuration_unverified` unless strict server-only remote auth + Supabase setting shapes are present, then `configured_unverified`; never live-verified.
- BUG-022: public website notice now distinguishes unreachable localhost read-only bridge from separate cloud mobile relay; avoids false native-connected claims.
- Exact new HEAD CI and real owner Windows/mobile E2E remain PENDING; BUG-029 multi-call Vision/Creative metering and BUG-026 compositor acceptance still open.
