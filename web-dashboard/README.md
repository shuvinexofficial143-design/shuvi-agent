# Shuvi Web Dashboard

This directory is the browser/Vercel surface for Shuvi.

It stays independent from local-only Tauri/Rust commands. Local Adobe, Blender,
filesystem, PowerShell and computer-control features must go through an explicit
secure local bridge when that layer is implemented.

## Local preview

From the repository root on Windows PowerShell:

```powershell
git fetch origin ui-dashboard; git switch ui-dashboard; git pull; cd web-dashboard; .\run-local.ps1
```

Or, after the branch is already checked out, double-click `run-local.cmd`.

The runner installs dependencies only when `node_modules` is missing and then
starts Vite on localhost.

## Vercel later

Do not deploy until the dashboard UI is approved.

When ready:
- Git branch: `ui-dashboard`
- Root Directory: `web-dashboard`
- Framework: Vite
