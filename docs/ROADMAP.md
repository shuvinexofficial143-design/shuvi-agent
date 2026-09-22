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
- [x] cooperative task cancellation between agent steps (active HTTP request finishes first)
- [x] session-scoped read-tool permission grants
- [ ] per-task token/cost meter
- [x] managed child-process RAM accounting
- [x] audit log persisted locally

## v0.3 — computer use
- [x] screenshot capture
- [x] AI screen inspection through selected vision-capable provider
- [x] open URL in system browser
- [x] Windows UI Automation foundation: exact element find, invoke/select, set value
- [ ] advanced UI Automation: window scoping, scroll, menus, keyboard fallback
- [ ] browser automation beyond opening URLs
- [ ] fallback coordinate actions
- [ ] failure recovery

## v0.4 — coding mode
- [x] workspace tree scan with common heavy folders ignored
- [x] workspace text search
- [x] unambiguous exact-text file edit
- [x] Git status and diff inspection
- [x] persistent workspace selection
- [x] structured patch/hunk editing through validated Git apply
- [x] typed Node.js/Rust test, build, lint and typecheck loop
- [x] Git stage/commit and high-risk push approval flow

## v0.5 — installer
- Windows installer
- first-run provider setup
- automatic updates
- crash recovery
- diagnostics export
