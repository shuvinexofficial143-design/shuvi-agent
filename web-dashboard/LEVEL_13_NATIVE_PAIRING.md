# Shuvi Level 13 — authenticated local read-only pairing (initial milestone)

Repository: `shuvinexofficial143-design/shuvi-agent`
Branch: `ui-dashboard`.

## What was really implemented

A minimal opt-in **HTTP loopback status endpoint inside the native Shuvi Tauri process**. This is not a mock local server and does not pretend that the browser can execute desktop tasks.

Native source:
- `src-tauri/src/web_bridge.rs`, registered in `src-tauri/src/lib.rs`
- Native UI: `src/main.ts`, under **AI Provider → Web Control Center**.
- Explicit user action **Start read-only bridge** binds `127.0.0.1:47771` and generates a 64-character ephemeral token from two independently generated UUIDv4 values.
- **Stop & revoke pairing** closes the listener thread and discards the native token.
- The only authenticated HTTP route is **GET /v1/status**. Its response reports protocol version, Shuvi native process type, version, OS PID and fresh server timestamp.
- The response explicitly marks `scope=status_read_only`, `tasks=not_exposed`, `approvals=not_exposed`, `permission_mode=native_approval_only`.
- Strict `Origin: http://127.0.0.1:1423`, exact `Host: 127.0.0.1:47771` validation, authorization bearer token, loopback binding, bounded request headers, read/write timeouts, no-cache headers and deny-by-default methods.
- No POST/PUT/DELETE API, tool dispatch, OS file access, PowerShell access, provider keys or action-approval API is added.

Web source:
- `web-dashboard/src/local-runtime.ts`, `src/main.ts`, `src/runtime-status.css`, `index.html`.
- Pairing code stays **in browser-tab memory** only, with the input cleared after the attempt. It is not saved in localStorage, sessionStorage, a query string or a cookie.
- Browser requests `GET http://127.0.0.1:47771/v1/status` with Authorization; CORS preflight is validated by the native listener.
- Browser refuses pairing from Vercel or any origin other than `http://127.0.0.1:1423`.
- On valid reply the dashboard displays **Status paired (read-only)** with native PID/version/heartbeat; it rechecks approximately every 10 seconds and returns Offline if status is lost. No browser drafts are converted into Running jobs.

## How to test on a Windows machine

Prerequisites: Windows, local repository with the `ui-dashboard` branch, Node.js, npm, Rust, Visual Studio Build Tools and native Tauri build requirements.

1. Fetch the branch:

   ```powershell
   cd C:\Users\shuvi\shuvi-agent
   git pull --ff-only origin ui-dashboard
   npm install
   ```

2. Keep the new web dashboard active on port 1423 (from the repository root):

   ```powershell
   npm run dev
   ```

3. **Separately** launch the genuine Windows native Tauri development app in another Terminal (not another generic Vite web page):

   ```powershell
   cd C:\Users\shuvi\shuvi-agent
   npm run tauri dev
   ```

4. Inside the *native Tauri app* go to **AI Provider → Web Control Center** and click **Start read-only bridge**. Copy the pairing code using your own computer. **Never paste the pairing code in a ChatGPT message or public screenshot.**
5. Open exactly `http://127.0.0.1:1423/` in Chrome, visit **Settings → Local bridge**, paste the code and click **Pair read-only**. Confirm that both the dashboard and Settings say **Status paired** with a native Shuvi PID.
6. Click **Stop & revoke pairing** inside the native app, wait for up to ~10 seconds, and verify the Dashboard becomes **Offline**. Alternately use **Disconnect browser** to clear the code from the browser tab.
7. Confirm that **Running**, **Approvals**, remote desktop commands and project files remain unavailable.

If Windows native Rust hasn't compiled or Shuvi.exe isn't launched, pairing should correctly fail; a passing web test cannot replace the Windows host test.

## Tests and limitations

- `web-dashboard/scripts/level13-runtime-bridge.test.mjs` verifies token/origin checks, expected read-only protocol, browser request shape, revoked/failed heartbeat handling and no browser-side privileged calls.
- `.github/workflows/native-readonly-bridge.yml` performs native Rust `cargo check --manifest-path src-tauri/Cargo.toml --lib` on Windows.
- Runtime pairing is **local-only** and explicitly opt-in; no Vercel relay, LAN exposure, Telegram task dispatch or auto-approval.
- Native task monitoring still requires authenticated task identities, durable queue, permitted status-only event contracts and host-side acceptance testing.
- No real Blender/Adobe execution has been tested by this stage.

## Next steps

Native host acceptance on the user's Windows machine; then design and implement task-ID-scoped **read-only** status/event subscriptions sourced from real Tauri state. Real command execution and approvals require a separate explicit authorization/safety review, not just possession of this status token.
