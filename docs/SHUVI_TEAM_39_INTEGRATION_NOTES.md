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
