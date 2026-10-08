# Shuvi Web Dashboard

This directory is the browser/Vercel surface for Shuvi.

It stays independent from local-only Tauri/Rust commands. Local Adobe, Blender,
filesystem, PowerShell and computer-control features must go through an explicit
secure local bridge when that layer is implemented.

## Local preview — one fixed browser URL

Use the new Control Center only, not the old Desktop frontend from the repository root.

From the repository root on Windows PowerShell:

```powershell
git pull --ff-only origin ui-dashboard
npm run dev
```

Always open **http://127.0.0.1:1423/**.

You may alternatively use `cd web-dashboard; npm run dev` or double-click `web-dashboard/run-local.cmd`. All of these now use the **same port 1423** with `strictPort=true`, so a port conflict is shown as an error rather than opening the wrong UI or switching to 1424.

**If the old "Ask Shuvi" UI still appears**, a previously started legacy Vite process is serving that port. Stop that process in its own VS Code Terminal with **Ctrl+C**, then start `npm run dev` again. Pulling GitHub changes cannot terminate already-running processes on your Windows machine.

The root Tauri Desktop frontend is retained solely for the native Windows runtime and is started explicitly using `npm run tauri dev` or `npm run dev:desktop` (port 1420). Never delete the native Rust or Tauri frontend while building the browser dashboard.

## Vercel later

Do not deploy until the dashboard UI is approved.

When ready:
- Git branch: `ui-dashboard`
- Root Directory: `web-dashboard`
- Framework: Vite
