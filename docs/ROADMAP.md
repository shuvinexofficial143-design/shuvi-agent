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

### Module N — bridge lifecycle and transport hardening
- [x] Desktop action allowlist validated against UXP routes.
- [x] Bound all outstanding commands, track dispatch ownership and reject unknown/duplicate/early/expired results.
- [x] Clean up cancelled requests and stale queued commands; interrupt waiters on bridge reset/stop.
- [x] Eight-hour pairing lifetime with start-triggered token rotation.
- [x] Bounded client threads, payloads, header parsing and socket deadlines; reject ambiguous/truncated framing.
- [x] Snapshot UXP pairing token; keep execution failure separate from result delivery uncertainty.
- [x] Four panel transport mocks and an allowlist regression added; 21 Node tests, validation and frontend build passed.
- [ ] Six Rust lifecycle/header/token tests added but not run locally (Rust unavailable).
- [ ] Real Premiere pair/unpair/reconnect, long command and late-result acceptance checks.

Estimate after Module N: code complete approximately 53%; runtime verified 0% this session; production readiness not established. These estimates do not count unsupported speed writes as implemented.
Next module: native keyframe/transition lifecycle through existing named parameter resolution, then deterministic target guards and other pending professional workflows above.

### Modules 1–2 / C — named keyframe and transition lifecycle
- [x] Read native keyframe tick positions for exact named video/audio parameters with bounded results.
- [x] Remove one exact inspected keyframe and set linear/hold/bezier interpolation through native transactions.
- [x] Require the inspected project/sequence/media/clip timing/parameter signature; reject stale and ambiguous targets.
- [x] Preserve high-risk permission, audit and mandatory checkpoint integration.
- [x] Serialize native project/sequence GUIDs to strings in bridge observations.
- [x] Inspect bounded keyframe values and known temporal interpolation where available.
- [x] Bounded [start,end) range deletion with exact-count guard and explicit all-keys opt-in.
- [x] Native video transition removal for one explicit clip start/end with high-risk approval and checkpoint.
- [x] Twelve mocked lifecycle tests added; 33 Node tests, validation and frontend build passed.
- [ ] Actual Premiere video/audio keyframe inspection, removal, interpolation and undo verification.
- [ ] Broader keyframe value update operations, transforms/PointF, effect enable/remove and masks.
- [ ] Real Premiere transition add/remove and range-deletion/undo verification.

Estimate after Modules 1–2: code complete approximately 56%; runtime verified 0% this session; production readiness not established (0% acceptance-verified).

Next: optional shared project/sequence/clip target expectations for existing destructive tools, preserving legacy callers. Then timeline/link/nesting capabilities, effects and curated recipes, audio, captions, MOGRT, diagnostics, review state and export. Rust check/tests and actual Premiere disposable-project verification remain pending.

### Module A/M — optional stale-target expectations
- [x] Typed optional project GUID/path, sequence GUID and up to 64 unique clip expectations; existing callers remain compatible.
- [x] Timeline exposes plain project/sequence expectations and bounded signatures from native media identity and clip timing.
- [x] Per-action desktop client carries guards through checkpoint and edit requests; old panels without capability version 1 are rejected.
- [x] Panel rejects project/sequence/clip changes and incomplete clip coverage before dispatch; project/sequence identity is rechecked when handlers acquire the project.
- [x] Seven new mocked tests; 40 Node tests, registry validation and frontend build pass.
- [ ] Rust compile/test execution and disposable-project Premiere runtime verification.

Estimate: code complete approximately 58%; runtime verified 0% this session; production readiness not established. Signatures are conservative snapshots, not native stable clip UUIDs or a lock against concurrent human edits. Next: timeline vertical/link-aware capability work, followed by effect lifecycle.

### Module A — timeline capability and selection safety
- [x] Typed read-only premiere_timeline_capabilities with observed native clone/subsequence presence and explicit unsupported vertical move, link inspection, replacement nesting and multicam boundaries.
- [x] Timeline clip selection state with unknown links represented explicitly; no media-based inference of linked membership.
- [x] Clone destinations must be existing same-kind tracks; missing native clone APIs fail explicitly.
- [x] Subsequence attempts selection restoration even after temporary-selection failure and reports restoration success plus unverified selected-content semantics.
- [x] Five new mock tests; 45 Node tests, validation and frontend build pass.
- [ ] Verified selected-only replacement nesting, native link-aware edits and runtime verification. No semantic UI fallback implemented.

Code estimate remains approximately 58%; this module tightens existing behavior and exposes boundaries rather than claiming unsupported editing features. Next: documented native effect lifecycle.

### Module C — effect lifecycle
- [x] Typed named video/audio component inspection and removal, using documented chain createRemoveComponentAction.
- [x] Removal requires inspected clip/ordered-chain signature, unique component resolution, high-risk permission and checkpoint; one native transaction.
- [x] Bounded chain inspection (128 components); unavailable removal, ambiguity and stale chains fail explicitly.
- [x] Enabled state remains unknown, enable/disable and native preset import explicitly unsupported; existing named recipes remain available.
- [x] Four new mocked tests; 49 Node tests, registry validation and frontend build pass. Rust schema test added but not executed locally.
- [ ] Real Premiere removal and undo verification; stable instance identity beyond conservative signatures.

Estimate: code complete approximately 60%; runtime verified 0% this session; production readiness not established. Next: reusable motion/color recipe construction using inspected parameter selectors.

### Modules C/D — motion and color recipe construction
- [x] Typed read-only planner inspects exact named video parameters and emits settings for existing saved/apply recipe tools plus optional target expectations.
- [x] Zoom/push/pull, directional slides, Ken Burns, fades, deterministic sampled handheld and static transform roles; native value endpoints/units supplied explicitly.
- [x] Eight curated color packs: Natural Correction, Cinematic Contrast, Warm/Cool Cinematic, Soft Wedding, High Contrast Reel, Neutral Product and Social Media Punch.
- [x] Color offsets require explicit native unit/min/max and inspected current values; unsupported/missing/animated static parameters report skipped roles.
- [x] Plans never edit; require frame review; no assumed parameter indexes, perfect grading or automatic coordinate conversion.
- [x] Six new planner/native-route tests; 55 Node tests, registry validation and frontend build pass.
- [ ] Native parameter unit calibration, host interpolation/visual verification, and end-to-end color/frame-review acceptance.

Estimate: code complete approximately 63%; runtime verified 0% this session; production readiness not established. Next: separate dialogue input, ducking plan and named audio execution.

### Module E — named audio automation and ducking plans
- [x] Typed read-only planner resolves an exact audio parameter and checks keyframe support, current baseline and absence of existing automation.
- [x] Supplied dialogue regions, bounded attack/release, overlap/short-gap merging and dB/linear-amplitude or explicit native target values.
- [x] Fade-in/out and pan endpoint plans use the existing named audio recipe execution path; no speech-detection claim or automatic application.
- [x] At most 128 input regions and 64 output keys; native time/value units explicit; returns clip expectations and audition/interpolation warnings.
- [x] Seven new tests; 62 Node tests, registry validation and frontend build pass.
- [ ] Real Premiere audio units/interpolation/audition verification and connected dialogue analyzer. Structured transcript adaptation follows with captions.

Estimate: code complete approximately 65%; runtime verified 0% this session; production readiness not established. Next: structured caption/SRT and transcript timing boundary.

### Module F — structured captions / SRT / transcript timing
- [x] Pure structured caption layer with bounded {start,end,text} validation and deterministic time sorting.
- [x] Strict SRT parser/serializer with UTF-8 BOM, LF/CRLF/CR normalization, multiline cues, malformed timestamp rejection and 24-hour timing bound.
- [x] 1 MiB file, 5,000-segment, 8,000-char-per-cue and 512 KiB total-text limits; zero/negative/sub-millisecond durations rejected.
- [x] Overlap detection/reporting; adjacent merging remains disabled unless explicitly requested with a bounded gap.
- [x] Transcript JSON adapter accepts only recognized segment arrays with explicit numeric seconds (or {seconds}) + text; unknown Premiere JSON shapes return supported=false instead of guessed timing.
- [x] Transcript export now includes a bounded structured-caption/SRT preview and caption capability object without expanding the localhost bridge limits.
- [x] Reviewed current Adobe UXP Transcript/Sequence/CaptionTrack docs: caption discovery/name/mute and transcript import/export exist, but no documented native caption creation/text editing/SRT import API was found. Native creation/import stays unsupported with an explicit external-SRT adapter boundary; no GUI-click fallback.
- [x] Fourteen caption regression tests cover normal/multiline/BOM/malformed/missing-number/overlap/duration/text/segment/line-ending/round-trip/merge/transcript/capability cases.
- [ ] Real Premiere transcript JSON shape verification and manual SRT import acceptance on a disposable project.
- [ ] Native caption creation/text-editing/import only if a future documented UXP API exposes it safely.

Estimate after Module F: code complete approximately 67%; runtime verified 0% this session; production readiness not established. Next: Module G — inspected MOGRT editable-property workflows.
