# Shuvi roadmap

## v0.1 — foundation
- [x] Tauri/Rust shell
- [x] provider selector UI
- [x] DeepSeek/OpenAI/OpenRouter adapter
- [x] Gemini adapter
- [x] Anthropic adapter
- [x] Ollama/custom endpoint support
- [x] OS credential-store API keys
- [x] RAM meter and 4 GB hard guard
- [x] permission-gated PowerShell
- [ ] CI verified green

## v0.2 — real agent loop
- [x] provider-neutral JSON tool proposal protocol
- [x] directory listing
- [x] UTF-8 file read
- [x] file write
- [x] directory creation
- [x] application/process launcher
- [x] tool observations returned to the model
- [x] per-task maximum step guard
- [ ] task cancellation while a provider request/tool is running
- [ ] scoped permission grants
- [ ] per-task token/cost meter
- [x] managed child-process RAM accounting
- [ ] audit log persisted locally

## v0.3 — computer use
- screenshot capture
- Windows UI Automation
- browser automation
- fallback coordinate actions
- failure recovery

## v0.4 — coding mode
- workspace selection
- repo map
- patch-based file editing
- terminal/test loop
- git diff review
- commit/push approval flow

## v0.5 — installer
- Windows installer
- first-run provider setup
- automatic updates
- crash recovery
- diagnostics export
