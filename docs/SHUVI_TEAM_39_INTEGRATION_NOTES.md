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

## Milestone 8 — Native read-only capability preflight before approval

- The seven Rust UIA mutation variants now choose a matching, immutable
  native UIA capability probe, based exclusively on the typed ToolAction.
  Arbitrary AI-provided capability scripts or selector-derived code are
  not executed. The probe runs inside the same OS HWND/PID/RuntimeId
  discovery that produces the prepared control identity.
- ui_click requires either InvokePattern or SelectionItemPattern.
- ui_set_value requires ValuePattern and refuses read-only controls.
- ui_toggle requires TogglePattern, and ui_expand_collapse requires
  ExpandCollapsePattern; ui_scroll requires a vertically scrollable
  ScrollPattern; ui_focus and ui_send_keys require keyboard-focus capability.
- Unsupported and ambiguous controls fail at native preparation *before*
  the owner reviews/approves. Existing execution-time RuntimeId and
  pattern checks are still mandatory; a capability can disappear later.
- PowerShell uses grouped ValuePattern/ScrollPattern property reads.
  New Rust unit and Node tests cover every variant plus unknown-tool
  rejection and read-only probe semantics.
- Scope overlaps only native UIA preparation in shared src-tauri/src/lib.rs
  and team39's native UIA module/tests. No merge, Windows live action,
  direct approval bypass or new automated retry was introduced.

## Milestone 9 — Bounded action freshness, real UIA postconditions and diagnostic readiness

- **Native consent freshness:** a Rust-prepared UIA control identity now expires
  after 60 seconds, even if the normal 10-minute pending-action TTL has not
  elapsed. The original Rust action ID is denied and audited on expiry.
  A new OS scan and a fresh owner approval are required; no automatic replay.
  Unrelated native tools retain their original 10-minute TTL.
- **Exact selector input:** all UIA name/AutomationId selectors are checked
  before native preparation for empty, padded, control-formatted and >180
  character names. These are model-provided selectors, NOT OS-derived
  authorization data.
- **Modal owner-safety:** both the prepare probe and the execution-time
  Rust/Win32 guard reject UIA owner roots whose IsEnabled is false or
  whose IsOffscreen is true, including many blocked owner windows behind
  modal dialogs. The guard never focuses or restores a hidden window.
- **Value:** SetValue executes at most once; bounded state-only reads compare
  ValuePattern.Current.Value against the approved exact Unicode value.
  Missing readback is an *uncertain side effect*, never an automatic retry.
- **Toggle and Expand/Collapse:** each mutation runs at most once; the
  same exact native RuntimeId is revalidated while polling the observed
  state, with up to five reads and bounded 60ms spacing.
- **Scroll:** rejects NoScroll/unavailable state and scroll attempts already
  at the requested boundary. A single ScrollPattern.Scroll call must show
  actual movement of VerticalScrollPercent in the requested direction.
- **Focus:** waits for HasKeyboardFocus on the same exact native control
  before claiming verified focus.
- **SelectionItem click:** Select() is not repeated; the selected state is
  read back and checked on the original approved RuntimeId.
- **InvokePattern click and SendKeys:** delivery/audit is not an independently
  proven user objective. The existing separately approved UIA readback and
  project postconditions remain mandatory.
- **Read-only acceptance diagnostic:** new explicit-operator script
  scripts/shuvi39-windows-uia-readonly-diagnostics.ps1 validates one exact
  named top-level Windows UIA target, HWND/PID, minimized/visible state,
  native monitor and DPI, modal state and bounded accessibility controls.
  It cannot click/type/focus/launch apps. Private titles and element labels
  are SHA-256 fingerprinted by default; -IncludeNames must be opted into
  explicitly. This diagnostic was not executed on a Windows desktop.
- **Regression coverage:** expanded existing native-identity and
  state-readback tests, Rust TTL/modal unit tests and new read-only
  diagnostic tests. Windows CI source success is not a proof of real
  editor accessibility-provider behavior.

### Shared integration / remaining limits

Only team39's Windows Vision branch was modified. Shared Rust
src-tauri/src/lib.rs overlap includes the prepared-action expiry check,
selector validation and focus/scroll/value/toggle/expand/selection executors.
All native consent, audit, original UUID, journal and worker leases remain
in their original places. No merge/deploy/live Windows action performed.
UIA providers can legitimately lag state changes or rebuild RuntimeIds,
and modal overlays may be exposed imperfectly. Fail closed, inspect and
ask for separate approval; do not retry a potentially mutating action.

## Milestone 9.1 — Audit-confirmed UIA expiry recovery, never replayed

- Native UIA approvals use a 60-second Rust-only prepared identity expiry.
  Rust removes the PendingAction and emits a specific denied audit BEFORE
  any tool execution, then returns its explicit expiry error.
- The WebView now distinguishes this narrow, audit-confirmed no-execution
  denial from ordinary UI mutation errors. A string or model assertion
  alone is not trusted. It must retrieve an exact native audit_log receipt
  with original action UUID, tool kind, event=denied and success=false.
  Any conflicting executed/started/failed event for the same UUID forces
  the original conservative unknown-outcome handling.
- With a corroborated denial, WebView and Rust publish the strictly
  action-bound revisioned v2 recovery phase native_denied. This can follow
  only the identical in-flight executing action; a normal paused phase
  cannot safely follow executing. The native_denied phase remains
  **inspection-only** and cannot reserve a new AI request or Windows action.
- Owner acknowledgement of the prior Rust audit is mandatory before a new
  desktop task. Then ui_windows/ui_discover and a NEW approval are needed.
  If either recovery store cannot be saved, the task is quarantined.
  No automatic mutation replay, provider retries or owner-approval bypass.
- New pure guard + tests cover denials, contradictions, cross-tool spoofing,
  missing/malformed/truncated audits, exact UUID, seven allowed mutation
  tool kinds and wiring ahead of the ordinary unknown outcome path.

## Milestone 9 — Independently audited state readback and native root provenance

- Read-only native ui_find now returns actual ToggleState,
  ExpandCollapseState, IsSelected, HasKeyboardFocus and
  VerticalScrollPercent when their UIA patterns exist. These values are
  gathered without clicks, focus changes or simulated keypresses. No
  ValuePattern text/password contents are exported to the model.
- ui_find and ui_discover attach ObservedWindowHwnd and ObservedWindowPid
  sourced from the live UIA root of the *new* audited observation, not
  from previously cached window titles or inferred model text.
- WebView refuses to create a typed audited control inventory if even
  one row's live native root differs from the current exact HWND/PID.
  Missing, invalid or contradictory native root evidence fails closed.
- Following a native UI mutation, independent ui_find or ui_discover
  must locate exactly one element matching the original action's
  Name/AutomationId, with the same native root HWND/PID. An arbitrary
  unrelated discovery or ambiguous duplicate selector does not unlock
  a second UI mutation. Every next action still needs owner approval.
- After ui_toggle, ui_expand_collapse, ui_focus or ui_scroll, the
  separately audited ui_find must also return native state evidence.
  Toggle requires a known UIA state, expansion must match the approved
  Expanded/Collapsed target, and vertical scroll requires a real position
  from 0 through 100. Focus is transient: a separately approved read may
  report HasKeyboardFocus=false because owner interaction moved focus back
  to Shuvi. This accepts only typed native true/false observation, never
  claims the external application is still focused. Rust action execution
  has its own immediate focus verification.
- A successful independent read is evidence that a particular control
  was observed at that time. It is never automatic proof the whole
  editing objective succeeded. For SetValue, the original Rust action
  retains its immediate exact-value verification; independent readback
  deliberately does not export the raw value for privacy.
- Regression tests cover substituted HWND/PID, duplicate/foreign
  controls, missing native state, wrong expansion, no focus, invalid
  scroll position and privacy. Native Agent approval-chain fixtures
  reflect actual OS-derived root identity in UIA read-only JSON.

### Shared-file integration

Changed native Rust read-only UIA arms in src-tauri/src/lib.rs and
team39-only JS observation/readback modules. These shared Rust lines
must be explicitly reconciled with parallel branch work. No cross-team
merge, Windows live action, payment, installer or autonomous retry.

## Milestone 9 — same native UIA control in independently audited readback

- The Windows read-only ui_find and ui_discover paths now include the
  original element's bounded signed 32-bit GetRuntimeId() array as
  ControlRuntimeId. Invalid, empty, missing, or over-64-entry native IDs
  are not emitted as fresh read-only control evidence.
- WebView audited control observations preserve a defensive frozen copy
  of ControlRuntimeId. Malformed/oversized arrays are rejected, never
  coerced from strings or arbitrary model text.
- Native Agent captures the immediately preceding *audited* UIA control
  observation before invalidating it for an attempted mutation, and
  associates that identity with the exact audited action's pending readback.
- When this prior snapshot contained a native RuntimeId, a later
  owner-approved ui_find/ui_discover read must match the exact original
  RuntimeId AND same window HWND/PID, selector, native receipt and
  unique observed control. A recycled same-name/same-AutomationId element
  cannot clear the pending readback requirement.
- Older sessions without a verified RuntimeId continue through the
  pre-existing strict HWND/PID and unique-selector checks; they are
  NOT presented as RuntimeId-proven. Rust separately binds exact UIA
  RuntimeId at native prepare/execute for all seven mutations.
- Nine new tests cover valid/invalid signed IDs, stale/replaced controls,
  same-label replacements, duplicate observations, cross-PID/HWND
  readbacks and the ordering of capture-before-invalidation.
- One legacy Web Control Center source assertion was updated to enforce
  the now-canonical audited pre-execution denial early-return branch
  rather than requiring its obsolete textual else nesting.

Limit: OS UIA RuntimeId can change during genuine application redraw.
Such a readback must fail closed instead of accepting a new element
without explicit re-observation and independent owner consent.
Source CI is not an authorized Live Windows application test.

## Milestone 9.1 — Win32-attested, double-checked read-only UIA root

- Named-window ui_discover and ui_find now run a native Win32/UIA root
  identity check BEFORE enumerating controls and AGAIN immediately
  before emitting observation JSON. This rechecks selected HWND, PID,
  exact caption, OS process PID, visibility, enabled/offscreen status,
  and minimized state, without restoring or focusing any window.
- If a modal disables the root, or the window is replaced during a
  read, its output is not trusted as a post-mutation UIA readback.
- Desktop-wide read-only ui_find (without a named window) retains its
  old non-mutating discovery behavior. It intentionally cannot assert
  named-app HWND/PID provenance or clear app-bound readback.
- The new native ControlRuntimeId field in both find/discover is
  independently checked against the earlier audited control identity
  when the prior observation included a native UIA RuntimeId.
- Per-action pre-mutation observation and timestamp are captured
  BEFORE potentially slow Rust execution, preventing the 45-second
  UIA inventory TTL from dropping valid identity while a tool runs.
- The Web Control Center's legacy source test now verifies the native
  audited denial early-return behavior instead of a removed else block.
- Additional readback and native-attestation regression tests verify
  identity rejection, malformed array shape, foreign PID/HWND,
  replacement RuntimeIds, name collisions and source ordering.

Limit: Win32 and UIA are external non-transactional APIs; a separate
Windows test session remains necessary for runtime claims. No native
application mutation, merge or Windows acceptance was run here.

## Milestone 10 — OS process-generation binding for native UIA and visible vision capture

- A Windows process can eventually reuse the same numeric PID and a top-level
  HWND can also be recycled. Matching only a title, PID and HWND is therefore
  not enough for a long-lived owner-approved action or delayed screenshot.
- Rust native UIA preparation now obtains the selected process's actual
  `Get-Process.StartTime.ToUniversalTime().Ticks` directly from the OS,
  alongside its HWND/PID and exact UIA control RuntimeId. The signed
  64-bit process creation tick count remains inside Rust's original
  `PendingAction.native_uia_target` and is never a model or WebView argument.
- During every one of seven UIA mutation paths, the same trusted action
  includes a read-only OS process start-time comparison immediately before
  each UIA pattern dispatch. Even if Windows has reused PID and HWND,
  a different process generation cannot inherit prior owner approval.
- Any missing or invalid process creation evidence fails closed during
  preparation. A changed, exited or inaccessible original OS process
  fails closed at execution, with no automatic retry or permission bypass.
- The explicit selected-window screenshot pipeline now samples OS process
  creation time before activating an approved app. It checks the same
  process generation before focus, after the foreground transition and
  after the pixel copy but BEFORE emitting/saving the PNG. An app restart
  during capture cannot send an image from a recycled HWND/PID.
- New source-contract tests and Rust unit tests cover parsing, positive
  64-bit ticks, absence/malformed birth time, action-specific native
  execution checks, screenshot ordering and fail-closed behavior.

### Integration / verification distinction

Only Team 39 branch files `native_uia_window_guard.rs`,
`target_window_capture.rs`, their tests and these integration notes
were modified for this milestone. Existing owner permission, action UUID,
native worker lease, journal, DPI/occlusion guards and screenshot receipt
stay canonical. Processes whose OS creation time cannot be read may be
blocked rather than guessed, by design. OS APIs remain nontransactional:
live Windows Adobe/Blender and multi-monitor acceptance requires separate
owner authorization. Source CI must be reported for the exact new SHA.

### Milestone 10.1 — Receipt and independently attested UIA readback

- Native selected-window capture rechecks original process generation
  after writing PNG and BEFORE publishing the screenshot receipt.
  The receipt now carries an OS-produced signed 64-bit ProcessStartTicks
  which the Rust PNG receipt verifier requires to be positive. It validates
  this proof but does not forward the raw timestamp into the model-facing
  identity label. On failure, the untrusted PNG is deleted, not sent.
- Named-window read-only UIA find and discover now snapshot the OS process
  creation time before enumerating controls and check the same generation
  again within their existing pre- and post-enumeration Win32 attestation.
  If the target app exits/restarts, no UIA readback is accepted.
- Screenshot and native UIA readback source-contract tests cover ordered
  process lifetime checks, restart rejection, bounded attested receipts
  and unchanged owner approval / no-automatic-retry boundaries.
- Process creation time may be unreadable for protected processes.
  These controls fail closed rather than inferring process identity.
  Native source CI and Windows live acceptance remain distinct.

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

## Milestone 11 — End-to-end process-generation evidence across audited window/control reads

- Native `ui_windows` now derives a trusted process creation time from Windows
  `Get-Process.StartTime.ToUniversalTime().Ticks` for each window, bracketed by
  Win32 HWND/PID and UIA identity checks. Inaccessible or restarted processes
  are not exported as trusted observation rows. The tick is a decimal **string**
  so JSON/JavaScript never round a 64-bit Windows time.
- Explicit named-window `ui_discover` and `ui_find` now attach their own OS
  process birth tick to each bounded control row. The existing named-window
  native before/after Win32 and process-generation attestation remains
  mandatory; desktop-global unbound `ui_find` has no app-generation claim.
- Native Dashboard verified `ui_windows` observations preserve the bounded
  generation string in immutable task-local identities. Malformed/unsafe
  numeric/scientific, negative and out-of-range tick inputs reject the *whole*
  window inventory rather than accepting an ambiguous subset.
- Audited UI control discovery and post-action readback bind the same
  window HWND, PID, process generation and previous control RuntimeId.
  A restarted application that recycles both HWND and PID can no longer
  clear pending readback on its new process generation merely by presenting
  the same title, AutomationId and RuntimeId.
- Existing historical fixture rows without process-generation fields retain
  compatibility and MUST NOT be represented as process-generation attested.
  Current native Windows production output supplies this evidence or fails
  closed on non-readable process creation time.
- `scripts/shuvi39-window-generation-end-to-end.test.mjs` covers opaque
  signed 64-bit tokens, mismatched window/control/readback, process reuse,
  invalid/native-unreadable evidence, and the native source handoff.
- Shared-file integration overlap: only Team39 UI read-only action arms inside
  `src-tauri/src/lib.rs`, plus Team39 dashboard observation/readback helpers.
  No owner approval, action UUID, Rust scheduler/lease, journal, auto-retry
  or other teams' branches were changed.
- **Status:** source implementation; exact HEAD CI must pass before
  claiming source-tested. Windows live OS/UIA acceptance is **not performed**.
  Native API races remain nontransactional and require disposable Windows
  host testing with separate owner permission.

## Milestone 12 — Exact UIA control reattestation before readback output

- Prior 21/21 successful CI at SHA 75e87b3 is the baseline. A still-live
  named-window root could outlast controls replaced/disabled by an editor
  during ui_discover or ui_find. Root attestation alone did not recheck
  each selected control after enumeration.
- New native read-only helper re-reads each *original* AutomationElement's
  signed RuntimeId, Name, AutomationId, role, enabled/offscreen state and
  app PID (for bound named reads). ui_find also rechecks focus, toggle,
  expansion, selection and scroll values when provider evidence exists.
  Any drift or missing provider refuses the whole observation.
- ui_discover rechecks only its max 150 selected results, removes the
  original temporary UIA element references before JSON output, and
  performs another root attestation. ui_find rechecks max 25 elements
  and app root again before emitting output. Desktop-wide unbound
  ui_find remains read-only and does not claim process-bound evidence.
- Regression in scripts/shuvi39-control-lifetime-reattestation.test.mjs
  covers actual native arm ordering, bounds, safe ephemeral references,
  identity/state checks, and fail-closed readback for changed controls.
- Shared src-tauri/src/lib.rs overlap only Team39 read-only find/discover
  arms. Owner approval, Rust UUID, mutation path, leases and journaling
  unchanged; no silent action retries, merge or live desktop actions.
- Source tested status must be established only from exact new SHA CI;
  dynamic Windows UIA provider redraw and Adobe/Blender live acceptance
  still need separately owner-authorized disposable-host verification.

### Milestone 12 CI follow-up — native root-source assertion compatibility

- Initial milestone commit c270dd1 had one frontend regression-test failure:
  the new test looked for a literal final Assert-ShuviObservedWindow in
  both read paths. ui_find actually inserts a previously constructed
  {finish_attestation} script at the native PowerShell execution boundary.
  The assertion now verifies the correct final emitted root attestation
  for either path, after per-element verification.
- Native UIA provider state comparisons use an explicitly typed temporary
  value before comparing enum/bool/scroll state, avoiding ambiguous
  PowerShell casting syntax. No mutation or permission semantics changed.
- Do not inherit the earlier 21/21 baseline; verify the exact new SHA.

## Milestone 13 — Role-bound UIA readback and contradiction-safe discovery

- Previous baseline SHA 6f97713 still has Windows/Rust CI pending at the
  time of this work; do not conflate those check results with this new SHA.
- The previously audited control role (exact ControlType.ProgrammaticName)
  is now captured alongside its RuntimeId at the action's original readback
  binding. A later ui_find or ui_discover with the same name,
  AutomationId, HWND/PID/process generation and even RuntimeId **cannot**
  clear pending readback if ControlType changed.
- A ui_discover inventory reporting two controls with the same non-null
  native RuntimeId is rejected as a whole, rather than picking the first
  apparent selector match. Missing legacy RuntimeIds retain backward
  compatibility, and the native mutation guard still independently requires
  its exact prepared RuntimeId.
- The Dashboard observed-control gate refuses malformed, whitespace-only,
  nonstring or hidden-format supplied selectors even when a different
  selector also matches. No unsafe .trim() exception or false permission
  can escape through the observation gate. Native Rust remains authoritative.
- Regression tests in scripts/shuvi39-role-locked-readback.test.mjs
  validate same-identity role substitution, duplicate RuntimeIds,
  malformed name/id input, correct untouched exact-selector behavior,
  legacy no-discovery control readback and mutation blocking.
- No changes to Rust authority, owner approval, app focus/keyboard,
  native GUI lease, action UUIDs, journal or recovery. No Windows live
  tests and no cross-team merge. Keep Draft PR #17 open.
