# Shuvi

Shuvi is a lightweight, permission-first Windows AI computer agent.

## Goals
- Windows 10/11, including normal 8 GB laptops.
- Shuvi hard RAM ceiling: 4 GB.
- User-selectable AI provider.
- Sensitive computer actions require explicit local permission.
- Single-click Windows installer is the product target.

## Providers
DeepSeek, OpenAI, Gemini, Claude, OpenRouter, Ollama and custom OpenAI-compatible endpoints.

## Stack
Tauri 2 + Rust + TypeScript/Vite + native WebView2. Provider API keys are stored in the OS credential store.

## Development

**Default browser UI: New Shuvi Control Center**, from `web-dashboard`.
The old `Ask Shuvi` frontend is **not** the normal browser preview anymore.

```bash
npm run dev
```

Open **http://127.0.0.1:1423/**. The web server uses port 1423 with strict port validation.
If port 1423 is occupied, stop the stale process first; it will not silently use another port.

The older frontend code remains solely because the native Tauri/Windows application currently depends on it. Start that legacy desktop development entrypoint only when needed:

```bash
npm run tauri dev
# or explicitly: npm run dev:desktop
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Tauri's native development server stays on port 1420; changing the default browser preview does **not** replace its native agent or permissions.

If a previously running localhost server still shows the old UI, terminate that existing Vite process in its Terminal (Ctrl+C) and run `npm run dev` from the repository root. Updating GitHub cannot remotely stop a process already running on your PC.

**Do not use `npm run dev -- --port ...` in the root repo** to preview the browser Dashboard. Use the fixed URL above, so existing local browser draft data stays on one origin.

See `docs/ARCHITECTURE.md` and `docs/ROADMAP.md`.
