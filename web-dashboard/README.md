# Shuvi Web Dashboard

This directory is the browser/Vercel surface for Shuvi.

It must stay independent from local-only Tauri/Rust commands. Local Adobe, Blender,
filesystem, PowerShell and computer-control features should be reached through an
explicit secure local bridge when that layer is implemented.

## Vercel

Use `web-dashboard` as the Vercel Root Directory.
