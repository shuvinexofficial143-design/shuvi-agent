# Shuvi 39 — Target-window capture milestone and integration notes

Base: `99c9e58ef0e43139edfe2d6464f6411be47e1aa0`
Team branch: `feature/shuvi39-windows-vision`
Scope: target-window screenshot, Win32 HWND/PID checks and read-only observed selection.
Integration status: **source implementation; Windows live unverified**.

## Behavior implemented in this branch

- For `inspect_screen` with an explicit target, the existing Rust execution path invokes
  `target_window_capture::capture_window_png(&window)`. This change preserves the
  existing authorization and action-journal path; it does **not** give the AI permission
  to capture or mutate arbitrary windows.
- The selected UIA HWND/PID must still be a visible, non-minimized Window, rather than
  restoring a minimized app without a separate owner request.
- PowerShell switches to per-monitor-v2 DPI context while reading Win32 pixel
  geometry and using screen-copy, and restores the previous context in `finally`.
  An unavailable DPI context fails closed.
- Window foreground, UIA identity, native PID, and exact rectangle are rechecked
  after capture. Screenshot is rejected on movement, loss of foreground or identity drift.
- Five sampled interior points are checked using `WindowFromPoint` to reject common
  foreign-window occlusion. **Sampling cannot prove complete absence of occlusion**
  or that a graphics surface was accurately captured, particularly for GPU editors.
- PNG header and pixel dimensions are compared to the Win32 capture receipt before
  the image path is returned. Invalid screenshots are removed; failed captures
  must not reach a paid vision provider.
- Existing `ui_windows` inventory guards continue to reject duplicate names,
  process mismatch and stale identity. New Node regression tests cover those contracts.

## Changed source and tests

- `src-tauri/src/target_window_capture.rs` — isolated Rust/Win32 implementation plus
  Rust pure tests for the receipt/PNG pair, including negative monitor origins.
- `scripts/shuvi39-windows-target-capture.test.mjs` — 6 contract/behavior tests
  that exercise real dashboard inventory guards and inspect the capture invariants.

No shared `src-tauri/src/lib.rs`, `Cargo.toml`, package or workflow change.
No other team-owned files changed. The caller signature and native action ID remain unchanged.

## Milestone 2 — Audited task-scoped window observation and screen guard

- `web-dashboard/src/native-window-observation-session.mjs` defines immutable
  WindowObservation v1 with `sourceTool=ui_windows`, exact Rust audit
  `sourceActionId`, observed and expiry times (2 minute maximum), and
  actual named HWND/PID/process/app identities. This is evidence, not approval.
- `web-dashboard/src/native-agent.ts` now stores the immutable snapshot in
  the existing per-thread map only after exact `verifiedExecutionReceipt`.
  It checks expiry before subsequent `ui_find`, `ui_discover`,
  `inspect_screen` and desktop UI mutations. An invalidated snapshot stays
  recorded as null so it cannot silently fall back to no-observation mode.
  Prior task/global clearing and existing owner-consent flows are preserved.
- The strict `observedWindowInventory` parser now rejects repeated HWNDs
  even with plausible titles. The Master observation summary and compact
  UI context reject the same malformed source evidence that staging rejects.
- `inspect_screen` for a named app now observes the same strict uniqueness
  checks as UIA discovery, including stale inventory and duplicate title.
  Explicit `window=desktop` remains subject to separate Rust owner scope;
  it is not treated as a named-app observation.
- `scripts/shuvi39-window-observation-session.test.mjs` covers distinct
  audited action IDs, expiry boundary, stale map semantics, process/title
  conflicts, duplicate HWNDs, exact target, screen capture preparation,
  and source-summary fail-closed behavior.

**Security boundary:** An expired snapshot is not a Rust permission revoke.
Native approved actions still need separate audited execution and GUI resource
lease. The existing no-prior-observation native-matching path is maintained
for backward compatibility; this update prohibits *downgrading* from a
previously audited but now stale snapshot.

**Limitations:** Staleness refers to time and local UI mutation invalidation;
external process/window changes between observation and action are not yet
bound by a native HWND/PID token. Source CI does not demonstrate real GUI
success or absence of foreign overlays on a GPU accelerated editor. Windows
acceptance listed below remains unverified.

## Shared-file integration review

`web-dashboard/src/native-agent.ts` is a shared wiring file. This team
modified only the observation import, the per-thread snapshot map/lookup,
the `ui_windows` success transition and the compact observation guard.
No action-preparation IPC parameters, ownership checks, task budgets,
`src-tauri/src/lib.rs`, scheduler, or other team modules were changed.
Cross-team integration must review potential overlapping edits to the import,
`compactObservedUi`, `observedWindows` Map and `decide()` block. The
session data stays WebView-local; no implicit cross-branch integration.

## Milestone 3 — UIA control grounding, approval expiry and post-mutation readback

- New `web-dashboard/src/native-ui-control-session.mjs` ingests the actual
  successfully audited `ui_discover` output into a bounded, immutable
  45-second control inventory. Each selected control carries Name,
  AutomationId, ControlType, enabled and offscreen state; the inventory is
  bound to the exact observed WindowObservation source action, HWND and PID.
- On supported selector-based UIA mutations (`ui_click`, `ui_set_value`,
  `ui_toggle`, `ui_focus`, `ui_expand_collapse`, `ui_scroll`), previously
  discovered controls must match exactly one observed selector in the same
  window. Duplicated names, disabled/offscreen controls, stale inventory,
  cross-process/title rebinding and mismatched selectors are rejected.
  Prior to the first `ui_discover`, existing Rust exact UIA matching stays
  operative; a failed attempted UIA discovery never grants a fallback.
- The existing Native Agent now keeps the model's exact proposed tool input
  alongside the Rust Prepared Action ID *within the same task only*. After
  owner approval, and **before** writing execution intent, it rechecks
  WindowObservation freshness, UIA control evidence and outstanding readback.
  Existing Rust consent, receipts, budget, durable recovery and execution
  lease still enforce the actual IPC call.
- New `web-dashboard/src/native-ui-readback-session.mjs` records an
  audited UI mutation's target HWND/PID and exact source action, requires
  a separately approved/read-audited `ui_find` or `ui_discover` in that
  same still-current target before the next mutation, and does not confuse
  another `ui_windows` listing with proof of a control state.
  Readback **does not assert that intended UI state changed**, only that a
  fresh independent control inspection occurred. Project/output checks
  remain necessary before claiming user task completion.
- `native-agent.ts` clears UIA controls on **attempted** mutations,
  window refresh and control rediscovery—even if an exception happens.
  It records verified control observations and clears pending readback
  only after the exact audited read action and HWND/PID match.
  Owner-denied and failed/unknown native actions are never retried.
- `scripts/shuvi39-ui-control-readback.test.mjs` exercises same-target
  selector resolution, repeated labels, disabled/hidden roles, TTL,
  changed native HWND/PID, malformed read output and required post-action
  readback without granting any new consent.

### Integration overlap (shared `native-agent.ts`)

Exact shared wiring touched: imports, `PendingTask.proposal`, per-thread
observation maps and cleanup, `compactObservedUi` role metadata,
`continueAfterVerifiedAction` action staging and Master guidance, first-tool
preparation, approval-time target checks, and the post-audit observation
transition in `decide()`. The native Rust action journal and original action
UUID remain canonical. Teams 37 and 38 must reconcile this logic explicitly
in later owner-authorized integration; no shared `main` merge is implied.

### Limitations remaining

Control IDs are observed and compared on the WebView side but current Rust
UIA actions still resolve from the typed title/selector in their own path.
A true native IPC contract carrying an expected HWND/PID and verifying it
atomically at the mutation boundary remains pending. Dynamic editor panels,
GPU screenshots, accessibility parent/child control ownership, multi-monitor
coordinate reliability and postcondition-specific UI effect verification
require owner-authorized Windows host acceptance. Source tests cannot
be presented as this live verification.

## Milestone 4 — Native Rust Win32/UIA execution-boundary checks

- `src-tauri/src/native_uia_window_guard.rs` implements a fail-closed,
  same-PowerShell-process validation of the selected top-level HWND and native
  PID, window visibility/minimized status, exact live UIA root HWND/PID, and
  the selected control's own PID, enabled and offscreen state. Explicitly
  selected app title is mandatory for native UIA mutations; desktop-root
  fallback is no longer accepted for these seven actions.
- Shared Rust wiring in `src-tauri/src/lib.rs` integrates the helper with
  **all seven UIA mutation arms**: click, set value, focus, scroll, toggle,
  expand/collapse, and keyboard fallback. Every pattern call has a native
  identity check immediately before mutation.
- Keyboard fallback performs a second Win32 root/element check **after
  SetFocus and before SendWait**, including foreground HWND match. This
  prevents keystrokes being sent to the Shuvi approval window when Windows
  refuses application focus.
- `ui_discover` now returns actual `IsOffscreen` from the native UIA
  provider, so the earlier WebView control gate can reject hidden controls
  using observed data rather than guessing.
- Rust unit tests exercise invalid target arguments and the injected Win32
  safety script. `scripts/shuvi39-rust-native-uia-identity.test.mjs`
  verifies seven real Rust branches receive execution-time checks.

**Important distinction:** This is a native Win32/UIA identity cross-check
at action execution, but it is **not** a fully atomic Rust-level comparison
against the HWND/PID recorded in an earlier `ui_windows` receipt.
The earlier snapshot is checked in the WebView before prepare and execute,
while native selection still resolves the model's approved title. A trusted
native `expected_hwnd/expected_pid` binding carried through the
prepared action and verified against OS state without TOCTOU would
strengthen this further. It must not be taken directly from untrusted model
proposals or bypass existing owner approval and GUI lease.

**Source CI is not Windows Live acceptance.** Only a separately
authorized, disposable Windows test fixture can establish whether these
PowerShell and Win32 APIs behave correctly with real editor UIA providers,
child/modal panels and multi-monitor setups.

## Milestone 5 — Rust-owned prepared UI window identity

- Every one of the seven native UIA mutation tools now performs a *trusted
  Windows OS/UIA probe during `stage_tool`*. Rust obtains the currently
  selected top-level native HWND, process PID and exact live UIA title,
  rejecting missing/hidden/minimized/ambiguous or mismatched targets.
- `PendingAction.native_uia_target` stores that OS-derived record, not a
  caller/model-provided `expected_hwnd` or `expected_pid`. Existing
  preparation approval, action UUID, budget, native scheduler, audit and
  durable recovery remain canonical.
- At execution, each UIA mutation uses the same Rust-Prepared identity,
  verifying its native HWND/PID/title and selected control ownership inside
  its own PowerShell invocation *immediately before* the pattern mutation.
  A replaced window with the same title cannot silently acquire a previous
  action's prepared token. Missing token is fail-closed.
- Keyboard fallback retains a second check after SetFocus and before
  SendWait, and now additionally participates in the WebView audited
  control-selector guard after UIA discovery.
- Tests: four Rust unit tests for typed target parsing, invalid/missing
  binding, trusted native probe and prepared-token source generation;
  `scripts/shuvi39-rust-native-uia-identity.test.mjs` asserts all seven
  Rust arms use the exact pending OS identity; UIA control regression tests
  verify SendKeys cannot reuse stale or hidden controls.

### Remaining honest limitations

The Rust binding derives from a fresh OS probe at preparation, **not**
directly from the prior WebView window observation. The WebView's observed
snapshot remains a separate prerequisite when previously recorded. The
identity comparison is made inside the same PowerShell execution process,
but Windows/UIA patterns are non-transactional; another process could still
alter application state immediately *after* the check. Native Win32 identity
cannot prove a click achieved a user-visible goal; readback and user task
postcondition inspection are still separate. No Windows host mutation, GPU
editor or multi-monitor acceptance test has been performed.

## Milestone 6 — Rust build integration and synchronous UIA state readback

- Fixed the Rust `PendingAction.native_uia_target` initializers used by the
  two disposable Premiere acceptance/calibration actions. These explicitly
  carry `None`, since they never target UIA and cannot inherit another
  action's HWND/PID authority. The previous branch CI correctly reported
  Rust E0063 for both missing fields; fixes preserve all other fields.
- Updated the existing static Premiere acceptance assertion to verify
  both construction sites use `native_uia_target:None`. This was a
  required integration-test update, not an execution policy relaxation.
- `UiSetValue` now re-reads `ValuePattern.Current.Value` after
  `SetValue()` and compares the exact Unicode value (ordinal comparison).
  It does not print the sensitive requested value.
- `UiToggle` records `TogglePattern.Current.ToggleState` before the
  call and requires an observed state transition afterwards.
- `UiExpandCollapse` compares `ExpandCollapsePattern.Current.ExpandCollapseState`
  with the approved Expanded or Collapsed state after the operation.
  All three checks are within the original permitted PowerShell action,
  after the Rust-owned HWND/PID and per-control gate. Errors are fail-closed,
  and **an error after a mutation may be an uncertain side effect**; never
  automatically retry. Do not assume immediate UIA state guarantees
  a persisted project or the full owner objective.
- `scripts/shuvi39-native-uia-state-readback.test.mjs` verifies actual
  executor order, prepared native identity checks and failure conditions.
  These checks are source-level until an owner-consented Windows host test.
- Cross-team shared-file overlap this milestone: `src-tauri/src/lib.rs`
  UIA arms and Premiere fixture constructor sites, and
  `scripts/premiere-acceptance-execution.test.mjs` legacy source assertion.
  Changes stay on team39's feature branch only.

## Milestone 6.1 — Windows UIA singleton readback compatibility

- Production Windows `ui_find` pipes UIA objects to
  `ConvertTo-Json -Compress`, yielding a single JSON **object** for one
  matched control, while `ui_discover` produces an **array** through
  `ConvertTo-Json -InputObject @($items)`.
- The audited readback parser now accepts a singleton object **only**
  for `ui_find`, and requires its Name/AutomationId to match the actual
  requested selector. It still requires the same fresh HWND/PID,
  current verified native action receipt, valid shape and bounded output.
- A malformed object, changed HWND/PID, mismatched control identity,
  missing selector, or failed native result never clears pending readback.
  `ui_discover` still requires its expected JSON array.
- Four regression tests cover real singleton results, foreign selectors,
  failed reads and malformed native output. A successful observation
  permits considering a next separately approved action; it does **not**
  assert the previous UI operation achieved its intended effect.

## Milestone 7 — Rust-owned exact UIA RuntimeId through owner approval

- Baseline 580444990277b0c6b82979caccfa402a3ebb275e passed all 21 checks.
  This new milestone has a separate CI result; do not inherit baseline status.
- Native preparation now resolves exactly one selected UIA control, in the
  same non-mutating PowerShell probe as the selected top-level window.
  The OS supplies native HWND, PID, title, bounded GetRuntimeId integer array,
  Name, AutomationId and ControlType. Ambiguous, foreign, hidden or disabled
  controls cannot become a prepared mutation.
- The selected control identity is parsed in Rust and held only in the
  original PendingAction, under its original action UUID and owner approval.
  Model and WebView inputs cannot forge an expected RuntimeId.
- Every one of the seven native UIA mutation arms re-resolves the element
  at execute time and compares its real RuntimeId, name, AutomationId and
  ControlType plus native HWND/PID/title to the Rust-prepared identity.
  Keyboard fallback revalidates after focus and before SendWait.
  Reused labels or AutomationIds cannot silently inherit an earlier approval.
- The PowerShell probe is composed by one-pass concatenation, not recursive
  template expansion. Strings from OS observation are safely escaped.
- Rust unit and Node source tests cover exact identity, ambiguous selectors,
  invalid/bounded RuntimeId, stale approval rejection and all seven paths.

### Scope / acceptance limitations

The shared src-tauri/src/lib.rs overlap is limited to the UIA native
preparation path. The existing PendingAction native_uia_target field, Rust
permission lease, audit and recovery are preserved. RuntimeId may change
legitimately when apps rebuild their UI: fail closed and inspect again.
These checks cannot atomically freeze an external application or prove
a complete editing objective. Real Windows UIA acceptance remains untested
without owner authorization. No merge or live desktop action was performed.

## Windows acceptance — explicitly NOT YET run

Run only with separate owner consent on a disposable desktop/test fixture.

1. Open a disposable desktop app and a Shuvi approval window, approve only the
   specific target observation, and verify the target PNG corresponds to the
   selected app HWND/PID, never the Shuvi foreground approval UI.
2. Repeat with two windows sharing a title, a stale HWND, an app terminating
   during capture, minimized/hidden app, cross-app overlapping topmost window,
   and an app moving/resizing during the copy. Each must fail with no image sent
   unless the observed target remains uniquely valid.
3. Repeat on mixed 100%, 150% and 200% DPI displays and a monitor positioned at
   negative virtual desktop coordinates. Inspect actual PNG dimensions and pixels.
4. Check the previous foreground window is restored when Windows permits.
   Exercise browser, Premiere and Blender with owned panels/dialogs as distinct
   cases. Note GPU accelerated or fully occluded rendering is **unverified**.
5. Confirm separately that the Rust owner-permission and GUI lease paths are
   intact, plus verify no incidental UI mutation other than an explicitly
   consented foreground switch.

## Team 37 / 38 / 40 / 41 integration contracts

- 37: use explicit audited `ui_windows` observation and `inspect_screen.window`.
  A text label or capture receipt must never authorize an action.
- 38: do not bypass native desktop execution lease. An observation has no
  ownership of the GUI mutation lane by itself.
- 40 / 41: app-specific panel handling must not assume that a sampled
  screenshot proves exact Premiere/After Effects/Blender editing success.
  Require output readback/evidence before reporting completion.
- Follow-up team-39 work: typed observed HWND/PID/freshness contract and
  complete UIA action/readback with staleness invalidation.

## Verification status convention

- Implemented: source added as above.
- Source Tested: list the **exact commit SHA** and CI jobs only after they complete.
- Live Verified: **NO**. Native desktop acceptance requires separate owner permission.
- Blocked: live Windows test access and owner permission; source development unblocked.
