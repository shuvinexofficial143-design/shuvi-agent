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
- [x] recursive project tree + bin creation + rename/move + media relink foundation
- [x] source in/out controls + Premiere 26.3+ subclip creation foundation
- [x] sequence-from-media creation + timeline track/clip inspection
- [x] deterministic clip trim foundation (video/audio, exact track + clip index)
- [x] exact clip delete + ripple-delete foundation
- [x] rolling edit foundation for adjacent clips
- [x] native insert/overwrite edit foundation with automatic .prproj backup
- [x] same-track clip move + insert/overwrite foundations
- [x] selected-clips subsequence creation + project-item sequence insertion
- [ ] vertical track moves, replacement nesting and multicam workflows
- [x] video transition foundation + installed transition discovery
- [x] video effect discovery/add + parameter inspection/static value control
- [ ] broader effect types/preset workflows
- [x] generic effect-parameter keyframe foundation
- [x] named multi-parameter video recipe foundation for transform/effect workflows
- [x] native speed inspection + typed rate/duration/preset/ramp/freeze planning boundary
- [ ] native speed/time-remapping writes and masks (not exposed in reviewed public clip API)
- [x] reusable named video parameter recipe foundation for Lumetri-style grading workflows
- [x] persistent reusable local video/audio recipe library + batch recipe apply
- [ ] curated color-specific preset packs
- [x] audio effect discovery/add + parameter inspection/static value/keyframe foundation
- [x] track mute control
- [x] reusable named audio parameter recipe foundation
- [ ] automatic gain/mix/ducking analysis recipes and track-level automation
- [x] MOGRT insertion from file path or Creative Cloud Library
- [x] clip transcription + bounded transcript export foundation
- [ ] caption-track/subtitle generation and editable graphics parameter workflows
- [x] proxy attach + offline/relink inspection foundation
- [x] batch proxy attach and batch media relink workflows with partial-failure reporting
- [x] active-sequence export + optional preset + Media Encoder queue handoff foundation
- [x] playhead-aware Premiere frame inspection through Shuvi vision
- [x] bounded multi-frame Premiere vision review foundation
- [ ] automatic review→edit→re-review convergence loop
- [x] timestamped .prproj backups before major sequence/timeline changes
- [x] sequence marker list/add/remove foundation for edit planning
- [x] atomic reusable parameter-recipe execution foundation
- [x] saved high-level parameter recipe library foundation
- [ ] curated reels, long-form, ads and cinematic recipe packs

## Professional module continuation — 2026-09-23

Progress estimates are provisional scope estimates, not measured product certification:
- Premiere code complete: approximately 45% of the requested professional scope.
- Premiere runtime verified: 0% in this continuation session.
- Production ready: not established (0% verified against the requested acceptance workflow).

### Module O — validation and panel load repair
- [x] Fix invalid context-inspection destructuring that prevented UXP JavaScript from loading.
- [x] Syntax-parse UXP and frontend sources during validation.
- [x] Check proposal allowlist, permission staging, typed action and executor separately.
- [x] Detect duplicate UXP routes, missing direct/dynamic recipe routes and nested-generic frontend invokes.
- [x] Ten regression tests, including deliberately broken routing/registration fixtures; run in CI.
- [x] Synchronize stale UXP README and roadmap entries for existing features.
- [x] Local npm install, npm test, npm run validate and npm run build passed.
- [ ] Local cargo check: Rust toolchain unavailable; Windows CI remains authoritative.
- [ ] Load panel, pair bridge and inspect a disposable project in real Premiere. Premiere 2026 is installed, but no running Premiere/UXP Developer Tool session was observed.

### Remaining professional scope (continue incrementally)
- [ ] A/H: stale-target safeguards, vertical moves, link-aware selection and reliable nesting/multicam capability boundaries.
- [ ] B/C: speed/duration/reverse/ramp capabilities, effect lifecycle, masks and keyframe lifecycle.
- [ ] D/E: curated color recipes, audio automation and dialogue-region ducking adapter.
- [ ] F/G: structured captions/SRT boundaries and inspected MOGRT property workflows.
- [ ] I: bounded media traversal, missing/duplicate asset reporting and batch safety.
- [ ] J/K: bounded iterative review state and structured multi-stage editorial recipes.
- [ ] L/M/N: export path/overwrite safeguards, required checkpoints and bridge lifecycle hardening.
- [ ] O: broader runtime/unit coverage, recipe schema fixtures and Windows Rust CI verification.

### Module B — speed workflow boundary
- [x] Native video/audio clip speed, reverse and source-span inspection through an exact track/clip target.
- [x] Typed, read-only plans for multiplier, target duration, normal/slow/fast presets, freeze intent and 2–32-point source-time ramps.
- [x] Explicit unsupported capability, applied=false and executable=false; no invented native setter or blind UI fallback.
- [x] Bounds, incompatible-field rejection, pitch/reverse intent and warnings about rounding, existing remapping and linked A/V.
- [x] Six Node planning/native-route mock tests added (16 total passing), validation and frontend build passed.
- [ ] Real Premiere speed inspection verification; native execution intentionally unavailable pending a documented supported adapter.
- [ ] Rust speed schema unit test execution (added to Windows CI; local Rust unavailable).

Estimate after Module B: code complete approximately 48%; runtime verified 0% this session; production readiness not established.
Next priority: checkpoint enforcement and bridge lifecycle safety before adding further destructive edits.

### Module M — required edit checkpoints
- [x] Replace optional backup success with a required checkpoint path for all 39 existing major-edit callers.
- [x] Refuse unsaved/missing/empty/non-.prproj sources; compare project identity and save result before copying.
- [x] Stream and flush uniquely reserved backup files; detect project size/mtime changes during copy.
- [x] Persist versioned checkpoint sidecars; keep the existing backup path in action results.
- [x] Bound source size, folder scans, backup count and storage; stop at retention limits without deleting old backups.
- [x] Available Node tests (16), registry validation and frontend build passed.
- [ ] Three checkpoint Rust unit tests added; execution pending Windows CI because local Rust is unavailable.
- [ ] Real Premiere save/checkpoint/edit verification on a disposable project.
- [ ] Carry project/sequence identity through command execution to eliminate the remaining active-project switch window.

Estimate after Module M: code complete approximately 50%; runtime verified 0% this session; production readiness not established.
Next module: bridge pending-command/result lifecycle, bounded connections/payloads and cancellation cleanup.
