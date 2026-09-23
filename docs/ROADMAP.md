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
- [x] session token usage meter when the selected provider reports usage
- [ ] provider-aware cost estimates
- [x] managed process-tree RAM accounting including browser subprocesses
- [x] audit log persisted locally

## v0.3 — computer use
- [x] screenshot capture
- [x] AI screen inspection through selected vision-capable provider
- [x] open URL in system browser
- [x] Windows UI Automation foundation: exact element find, invoke/select, set value
- [x] advanced UI Automation foundation: exact top-level window scoping, focus and semantic scroll
- [x] advanced UI Automation extras: toggle, expand/collapse menus and high-risk exact-target keyboard fallback
- [x] browser/app semantic automation foundation through window-scoped UI Automation + vision fallback
- [x] isolated managed Edge/Chrome browser sessions with dedicated profile and RAM tracking
- [x] dedicated Chromium DevTools DOM read/click/value/navigation control
- [x] high-risk coordinate pointer fallback after semantic/vision targeting fails
- [x] agent recovery guidance: refine selectors / inspect screen instead of blind retries
- [x] transient provider retry/backoff for timeouts, connection errors, 429 and common 5xx responses
- [x] crash recovery with atomic local task checkpoints + explicit resume/discard

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
- [x] NSIS Windows installer configuration + manual release workflow
- [ ] installer build verified on Windows runner
- [x] first-run provider/model/API-key setup
- automatic updates
- crash recovery
- [x] privacy-safe diagnostics export


## v0.6 — Premiere Pro professional editing
- [x] Premiere UXP bridge scaffold + dockable Shuvi panel
- [x] Windows Premiere installation detection + typed launch
- [x] read-only active project / active sequence inspection scaffold
- [x] authenticated localhost Shuvi desktop ↔ Premiere UXP command bridge + pairing UI
- [x] active-project root item inspection + permission-gated media import
- [ ] bin creation/move/relink project organization
- [x] sequence-from-media creation + timeline track/clip inspection
- [x] deterministic clip trim foundation (video/audio, exact track + clip index)\n- [x] exact clip delete + ripple-delete foundation\n- [ ] rolling edit operations
- [x] native insert/overwrite edit foundation with automatic .prproj backup
- [x] same-track clip move + insert/overwrite foundations\n- [ ] vertical track moves, nest and multicam workflows
- [ ] transitions, effects and effect-parameter control
- [ ] keyframes, transforms, masks and speed changes
- [ ] Lumetri color workflow and reusable grading presets
- [ ] audio gain/mix/ducking and track-level workflows
- [ ] captions/subtitles and graphics workflows
- [ ] proxies and large-project media relink workflows
- [x] active-sequence export + optional preset + Media Encoder queue handoff foundation
- [ ] preview-analyze-correct editing loop using Shuvi vision
- [x] timestamped .prproj backups before major sequence/timeline changes
- [ ] reusable editing recipes for reels, long-form, ads and cinematic edits
