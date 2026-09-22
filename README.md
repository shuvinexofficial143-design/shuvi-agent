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
```bash
npm install
npm run tauri dev
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

See `docs/ARCHITECTURE.md` and `docs/ROADMAP.md`.
