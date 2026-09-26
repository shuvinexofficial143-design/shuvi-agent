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

### Earlier Module O — validation and panel load repair (historical)
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

### Module G — inspected graphics/MOGRT properties (2026-09-24)
- [x] Read-only typed premiere_inspect_mogrt_properties and premiere_plan_mogrt_recipe routes with exact bounded video targets.
- [x] Generic native clip/component/parameter inspection, primitive start values, keyframe/time-varying state and actual setter-method presence.
- [x] Honest capability boundary: no asserted native MOGRT identity or inferred Essential Graphics field roles.
- [x] title/lower_third plans accept exact supplied selectors; text roles require inspected strings, property roles require exact primitive type equality. Complex/time-varying/unavailable fields are skipped, duplicates/oversized requests rejected.
- [x] 128-component, 128-parameter/component, 256-total-parameter, 2048-value-character and 48000-serialized-character budgets. Incomplete inspection cannot produce editable settings.
- [x] Returns existing project/sequence/clip expectations and settings for the checkpointed high-risk video recipe executor; no new write path.
- [x] Seventeen graphics tests added; 93 total Node tests pass, registry validation and frontend build pass. Fixed pre-existing transport/speed fixture loading of the caption module from c986c3f.
- [ ] Rust schema tests/compilation: local Cargo unavailable. Real Premiere template text/property edit, undo and visual verification pending.

Conservative estimate after Module G: code complete approximately 69%; runtime verified 0%; production readiness not established. Next: Module I — bounded project/media diagnostics. Native type/setter presence is not proof that any particular template accepts a write.

### Module I — bounded project/media diagnostics (2026-09-24)
- [x] Low-risk typed premiere_project_diagnostics tool, explicit bridge allowlist and existing audit/expectation request path; no checkpoints or writes for inspection.
- [x] Project/active-sequence identity, native sequence count, visited project-item/bin/media/sequence counts, offline/proxy/unknown state and actual-path extension summary.
- [x] Iterative depth-first traversal with 10000-item/32-depth/10-second cooperative limits, cycle avoidance, per-field error isolation and explicit partial counts.
- [x] Bounded details, duplicate absolute-path candidates and repeated project-item ID groups. Windows ASCII case/slash normalization preserves other path semantics; no filename-only matching or automatic repairs.
- [x] Proxy attachment/path separated from usability; proxyUsable remains null. Unknown paths/status never imply offline/healthy media.
- [x] 200 media details, 50 groups per group list, 8 members/group, 32 errors, 2048-character paths, 64 extension keys and 48000 serialized-character response limit; omitted detail/group counts remain explicit.
- [x] Nineteen diagnostics tests including hard 10000-item and escaped-output budgets; 112 total Node tests pass. Registry validation and frontend build pass.
- [ ] Rust compile/schema tests: local Cargo unavailable. Real Premiere read-only large-project verification and native folder-call latency/memory checks pending.

Conservative estimate after Module I: code complete approximately 71%; runtime verified 0%; production readiness not established. Module G and Module I are separate committed/pushed units. No Module J implementation started.

### Module J — bounded visual-review convergence foundation
- [x] Five typed session tools: start/status/next/record_fix/cancel; local UUID-scoped JSON with atomic replacement and recovery backup. Four frames per review, sixteen issues, eight iterations and 32 vision calls per session.
- [x] Active project/sequence identity checked before reviewing and recording a fix. JSON-only normalized vision observations; unknown categories, excessive text, ungrounded timestamps and duplicate issue IDs are rejected.
- [x] Each proposed fix names a known planner or is explicitly unsupported. No vision-supplied settings or arbitrary code execute. Record-fix requires an audited successful typed Premiere action ID; the edit itself remains under existing approval, checkpoint and expectation machinery.
- [x] Same-position after review yields improved/unchanged/regressed/uncertain using actionable issue counts and confidence; this is a heuristic, not objective image scoring. Cancellation, low confidence, no actionable issues, iteration limit and duplicate failed fingerprint stop the loop.
- [ ] Precise clip/parameter binding from vision observations to safe deterministic edit settings remains manual inspection; all automatic fix proposals report supported=false until exact target binding can be proved. Audit receipt confirms a successful typed edit, but does not cryptographically bind its settings to the recorded fingerprint.
- [ ] Rust compile/tests and disposable-project Premiere/UXP runtime acceptance remain unverified in this environment. No professional quality guarantee.

### Module K — professional multi-stage editorial recipe packs
- [x] Read-only `premiere_plan_edit_recipe` with schema version 1, a 32-stage/32 KB ceiling, dependency ordering and cycle rejection. Eight packs: social reel, cinematic reel, talking head, product ad, wedding highlight, long-form YouTube, story/explainer, and clean corporate.
- [x] Each plan returns typed stage capability, exact target/parameter requirements, supported and blocked stages, missing inputs, review requirement, and finite stage state. Executable-code fields and unknown presets are rejected. Plans never modify Premiere.
- [x] Cut regions, named parameters, audio regions and review timestamps require exact bounded supplied values. Social beats, long-form B-roll assets and story narration timing are explicit dependencies. Native captions, speed writes, masks, multicam and vertical track moves remain blocked.
- [x] The existing saved parameter recipe library remains separate. A mutating stage is performed through the existing individually approved, checkpointed typed tool, then reviewed with Module J; no batch executor was added.
- [ ] Runtime recipe orchestration and native Premiere host acceptance remain pending. Rust compile/tests unavailable locally; editorial intent and quality are not guaranteed.

Next Premiere priority: export/output hardening and disposable-project Premiere+UXP acceptance. Resolve remaining capability gaps only with verified host support.

### Module L — export/output hardening
- [x] Read-only `premiere_plan_export` checks bounded absolute output/preset paths, parent existence, collisions, overwrite intent, exact active project/sequence identity, and AME installation. It returns a whole-sequence expectation for the existing high-risk export tool.
- [x] Export now requires that expectation and `overwrite=true` for an existing regular file. A changed project or sequence is refused at the desktop and by the UXP expectation guard. Existing output and preset are never deleted by planning.
- [x] The panel distinguishes accepted immediate calls from queued AME calls. Adobe's documented boolean return does not prove encoding completion. Post-call file metadata is a separate observation and never sets `completion_verified=true`. A lost/late bridge result is explicitly uncertain and is never retried automatically.
- [x] Immediate call timeout is bounded at 120 seconds and queue handoff at 45 seconds. Longer or disconnected operations can leave status unknown; the user must inspect Premiere and output before another attempt.
- [ ] Runtime acceptance on a disposable project remains unverified. There is a filesystem race between the desktop collision check and Adobe writing the file; do not assume an atomic no-overwrite guarantee from the UXP API.

Next Premiere priority after Module L: versioned runtime acceptance evidence and capability audit (Module O), followed by disposable-project Premiere/UXP testing.

### Module O — Premiere runtime acceptance evidence
- [x] Version 1 local capability matrix for 33 capabilities, with separate `code_tested` and `premiere_runtime_verified` fields. States: not_implemented, implemented_unverified, runtime_verified, unsupported_documented, runtime_failed and blocked_environment.
- [x] Bounded 64-entry/96 KiB evidence, project/sequence GUID, host version, action, result and recovery fields; atomic local persistence with recovery backup. No screen captures, base64 media or credentials are stored.
- [x] Read-only `premiere_acceptance_report` and `premiere_acceptance_probe`. Group 1 is a real paired-panel probe for context, timeline and bounded diagnostics; it promotes five capabilities only after consistent live host replies. Groups 2–8 report blocked until a disposable project and the relevant safe host harness exist; they launch no destructive edits.
- [x] Duplicate/bogus evidence, malformed versions, overlarge reports and unsupported capability promotion are rejected in Rust tests. Node/mock tests and real host evidence are not conflated.
- [x] Re-audited current official UXP EncoderManager, SequenceEditor, VideoClipTrackItem and CaptionTrack reference pages. The reviewed VideoClipTrackItem offers getSpeed but no speed write; SequenceEditor exposes clone vertical offset, not a general vertical move; no reliable caption creation/editing API was found in the reviewed CaptionTrack page. Keep other listed gaps unsupported pending method-specific review and disposable-project proof.
- [ ] Rust unit tests/compilation unavailable in this environment. No Adobe Premiere+paired UXP host is present; **runtime verified remains 0%**. Production readiness remains unestablished.

Code-complete estimate after L/O: approximately 74% (conservative feature coverage estimate, not a measured test pass rate). Runtime verified: 0%. Production ready: no. Next: run Group 1 against an actual paired Premiere panel, then introduce each remaining group on a provably disposable .prproj with approval, checkpoint, expectation and recovery evidence. Export completion still needs a separately verified native completion signal.
- [x] Module P foundation: explicit approved disposable `.prproj` registration binds the live project GUID, absolute path and optional sequence GUID; atomic bounded local persistence and fresh host identity revalidation. Read-only `premiere_acceptance_plan` lists one-at-a-time typed group actions, with mutating actions requiring their existing permissions, project checkpoint, exact expectation and audit receipt. No blanket destructive acceptance runner or automatic runtime promotion; groups 2–8 still require actual paired-host tests. Code complete estimate remains conservative; runtime verified remains 0% without real Premiere.
- [x] Module Q: read-only `premiere_resolve_review_target` and `premiere_bind_review_fix` ground an existing review issue to one of its recorded sample timestamps, enumerate up to 16 active clips including overlaps, require nontruncated timeline signatures, inspect native components or MOGRT properties and return exact expectation plus typed planner family. Ambiguous, animated, complex, caption/continuity and unknown bindings remain unsupported for direct fixes. No edits dispatched; host runtime verification pending.
- [x] Module R: version 1 persisted professional edit sessions reuse all eight Module K recipe packs and their existing blocked/missing dependencies. A 32-stage/96 KiB/64-event run selects only one eligible stage, records an existing typed action via recent audit ID and requires an actual Module J completed review for review stages. Module Q binding is returned as the correction path when review is unacceptable. Project/sequence identity is checked before advancing or recording; cancellation persists and failed stages do not retry. Running a recipe does not promise subjective quality or circumvent typed approval/checkpoint/audit. Runtime verified remains 0% without a paired Premiere host.

After P/Q/R: code complete approximately 74% as a conservative feature coverage estimate; runtime verified 0%; production ready: no. Exact next priority is disposable Premiere + paired UXP host acceptance, native parameter-unit calibration, and independently observed export completion. Unverified native speed writes, masks, vertical move, replacement nesting, multicam, linked clips, caption writes and complex MOGRT values remain unsupported.

### Module S — bounded host acceptance execution
- [x] Prepared, persisted, version 1 single-action disposable acceptance fixture for Group 2 trim, same-track move and clone only. Requires live paired UXP, registered project GUID/path, exact sequence and clip signature, bounded change (at most 3 seconds), normal high-risk approval, existing typed tool checkpoint/expectation, and native timeline post-inspection. One prepared ID executes once; a crash or transport uncertainty never triggers automatic retry.
- [x] Verified trim timing may promote `trim` only after a real native reply and post-state; move/clone action evidence cannot promote the aggregate `move_clone` capability from one step. Clone cleanup is explicit. Cancellation persists; a running native action may still complete. Recovery remains unverified until tested.
- [ ] Other Group 2 steps (transition add/remove), Groups 3–8 and recovery verification remain blocked for host execution until exact post-state or specialized disposable fixtures are implemented. No mock-only capability promotion.

### Module T — exact native parameter observation and bounded calibration
- [x] Version 1 local 96 KiB/128-entry registry keyed by Premiere version, exact native component, parameter and value type. Read-only observation requires a fresh clip signature and complete native inspection. Semantic role is caller-supplied but remains unverified; units default to `native_unknown`.
- [x] On an explicitly registered disposable project, one high-risk numeric probe permits a static delta of no more than one native unit and 1% of observed baseline. Existing typed named setter supplies permission, checkpoint and stale-target guard for delta and restore. Native reinspection verifies the changed and original values; uncertain delivery or failed restoration records `needs_recovery`/`uncertain` without blind retries. PointF, unknown interpolation and unobserved semantic unit claims stay unsupported.
- [x] Existing video/audio/MOGRT planner outputs surface only exact calibration records whose native delta, recovery, semantic role and unit are all verified. They do not invent settings; no semantic unit can be promoted from a name or numeric delta alone. Real Premiere calibration and subjective direction checks remain pending.

### Module U — export observations and readiness gate
- [x] Every export dispatch stores a version 1 bounded atomic local job record before the native call, retaining project/sequence, destination/preset, mode, preexisting output and pre-export file metadata. Delivery uncertainty is stored before sending; no automatic retry. Accepted immediate, accepted AME queue and rejection remain distinct.
- [x] `premiere_export_status` makes one read-only metadata observation per call (at most 8 retained), with stable size/mtime requiring two observations at least 1.5 seconds apart. `file_stable`, `media_parse_verified=false` and `encoder_completion_verified=false` remain separate. File stability never promotes export completion.
- [x] `premiere_readiness_report` separates estimated code coverage, mock capability coverage, Rust attestation, native runtime capability count, recovery observations, export completion and explicit baseline gates. Production ready remains false until host evidence meets all mandatory gates.
- [ ] Official EncoderManager reference documents `EVENT_RENDER_COMPLETE`/`EVENT_RENDER_ERROR`, and EventManager documents registration, but the reviewed pages do not specify a guaranteed event payload mapping to Shuvi's exact output/job. A correlatable host signal and playable-media verification remain unimplemented; no false `completed` claims.
- [ ] Runtime acceptance for Groups 2 transitions and 3–8, actual Premiere/UXP tests, native unit/semantic calibration and recovery acceptance remain outstanding. Conservative code-complete estimate remains approximately 74%; runtime verified 0% without a real paired host; production ready: no.

Next Premiere priority: run paired Premiere on an explicitly registered disposable project, fix any Rust/host regressions, verify effect/audio/review/export outcomes and correlate a documented native completion event before production-readiness promotion.

### Premiere subtitle delivery and inspected graphics (Module V)

- `premiere_write_srt` writes validated UTF-8 captions to an absolute `.srt` file under an existing directory. Existing files require explicit overwrite approval; cues and text are bounded. `premiere_transcript_to_srt` reads real Premiere transcript segments and writes only complete recognized timing (at most 256 cues/60,000 characters per bridge delivery); unknown or oversized schemas fail without a partial file. Native Premiere caption creation remains unsupported.
- `premiere_populate_mogrt` accepts user-supplied exact native component/parameter selectors and a fresh clip expectation, re-plans against the inspected host, refuses ambiguous or incompatible fields as a group, takes a `.prproj` checkpoint and applies the typed video parameter recipe. A supplied MOGRT still needs the existing `premiere_insert_mogrt_path` action; batch insertion and persistent template mapping remain outstanding. No semantic role is inferred from native display names.
- Feature coverage remains about 74% conservatively until batch graphics, talking-head audio finishing, multi-clip finishing and shot-list assembly execute end to end; runtime verified 0% without a paired Premiere host.

### Transcript-driven dialogue ducking (Module W)

- `premiere_plan_transcript_ducking` exports the actual recognized transcript, maps explicit segments into an inspected music parameter domain using caller-supplied offsets, optionally merges gaps up to five seconds, and returns native keyframe settings from the existing audio planner. `premiere_apply_transcript_ducking` redoes the same live inspection, requires an exact audio clip expectation and high-risk permission, checkpoints the `.prproj`, then applies the existing typed audio recipe. No VAD, inferred timeline offsets, assumed dB unit or loudness normalization. Fades remain available through `premiere_plan_audio_automation` and `premiere_apply_audio_recipe`; selected transcript markers and cut batch tools remain outstanding.

### Explicit multi-clip finishing (Module X)

- `premiere_batch_finish` accepts up to 32 caller-selected video clips, each with its own existing curated motion/color recipe request and inspected clip signature. It re-plans each against the live native parameter, rejects skipped bindings per clip, takes one mandatory `.prproj` checkpoint before its first edit, applies the existing typed video recipe under a high-risk approval, and returns individual applied/failed/uncertain results. `premiere_batch_finish_cancel` stops between clips. Uncertain delivery stops the batch; no blind retry. Review is recommended after the batch, not automatically inferred as successful. Audio and graphics multi-clip finishing and automatic visual sample selection are still pending.

### Explicit timeline assembly (Module Y)

- `premiere_plan_assembly` checks up to 64 exact supplied project clip IDs against the paired host, active project/sequence and existing track counts; `premiere_apply_assembly` takes a high-risk approval, requires fresh project/sequence identity and checkpoint, then invokes existing native insert/overwrite per shot. Higher existing video tracks support explicit B-roll placement. Up to 32 explicit Chapter markers are added only when all shots succeeded. The action returns per-shot results and a bounded post-edit timeline; `premiere_cancel_assembly` stops between edits. Source in/out within this batch, inserted graphics, transition chaining, ducking and inferred beat sync remain unsupported. Create an explicit subclip first if a source range is required, then supply its ID.

### Module V2 — professional batch graphics (2026-09-26)

- Freshly fetched remote `main` at start: `784a8aec2aff873e2e8041908fb906b673645320`; recent commits and current foundation modules were inspected before changes.
- Added saved template mappings with exact native selector/type validation against an inspected reference clip, explicit user-defined roles, local file or library source, 64-entry/96 KiB storage bounds and revision-checked update/delete. Template provenance remains caller-supplied; no semantic name inference or arbitrary executable fields.
- Added `premiere_batch_graphics` / `premiere_batch_lower_thirds`: up to 32 actual insert → exact native receipt correlation → inspect → mapped primitive recipe → readback workflows. Titles, chapter cards, lower thirds, price, CTA and location use the same executor. Each item carries exact native video expectations and observed audio additions when available.
- Conditional duration shortening uses the existing typed trim action for video-only graphics and verifies the native result. Extension, inferred linked audio trim and complex native values remain unsupported; original native duration is reported honestly.
- One required project checkpoint, project/sequence expectations, existing-track/occupied-placement guards, cancellation between items, explicit partial results and conservative stop on uncertain native/bridge delivery. Failed template validation can leave an inserted default graphic; no automatic rollback or blind retry.
- 29 new native-mock tests; **166 Node tests pass**, validation passes and frontend build passes. Nine Rust tests added; local Rust/Cargo unavailable, so Rust compilation/tests remain unverified. Previous main CI run `36040993736` was red with zero steps in both jobs; that is not evidence of a source failure. Real paired Premiere/UXP acceptance remains pending.
- Usage, input examples, recovery and bounds: [PREMIERE_GRAPHICS.md](PREMIERE_GRAPHICS.md).

Current conservative **feature code coverage: approximately 75%** (before: approximately 74%). The small increase counts usable batch insertion/population/duration functionality, not the mapping registry alone. **Runtime verified: 0%. Production ready: no.** These are separate metrics; the code estimate is a scope estimate, not a measured test coverage percentage.

Continuation boundary: V2 implemented; W2, X2, Y2 and Z expansions are not complete. Next real feature: W2 explicit transcript selections and deterministic cut application, followed by selected chapter markers and a composed talking-head audio/finishing workflow. Existing W/X/Y foundations above remain available. Continue W2 → X2 → Y2 → Z with separate validation, commits and pushes. Native speed/time-remapping writes, masks, general vertical moves, inferred links, native caption writes, multicam, replacement nesting and complex MOGRT values remain unsupported.


### Module W2 — explicit transcript selections and talking-head cuts (2026-09-26)

- Added `premiere_plan_transcript_cuts` and `premiere_apply_transcript_cuts` backed by a dedicated bounded `premiere_talking_head.rs` module. Native transcript timing is re-exported on every plan/apply; deterministic segment IDs and an FNV-1a transcript snapshot prevent applying stale transcript selections.
- Explicit `keep` / `remove` / `chapter` / `highlight` selections map through a caller-supplied transcript→sequence offset. Padding is bounded to 0–2 seconds, remove ranges merge deterministically, and Chapter/Comment markers reuse the existing typed marker route.
- Real executable cut support now covers safe clip-edge trims and whole-clip deletion through the existing `trim_clip` / `delete_clip` routes. Interior removals that require a split fail closed with `supported=false`; no blind coordinate split path was added.
- Video/audio are explicit independent targets. Native linked membership is never inferred; matching inspected intervals are required, and ripple deletion with separate A/V targets is refused to avoid shifting an unverified linked counterpart.
- Apply requires exact fresh clip expectations, a matching transcript snapshot, a durable `.prproj` checkpoint, and native post-edit timeline reinspection. Unknown/timeout bridge delivery stops the workflow without retry. Existing transcript ducking/fades remain the audio-finishing path.
- Added Rust unit coverage for edge trim/interior refusal/chapter mapping/A-V ripple refusal plus Node structural safety tests. This environment could not execute Cargo/Node locally, so test execution remains to be confirmed by CI or a development machine.

Conservative feature-code estimate after W2: approximately **76%** (up from 75% because explicit transcript selections now produce real safe Premiere cuts/markers rather than only ducking plans). Runtime verified remains **0%** without a paired Premiere host; production ready: **no**. Next real feature priority: X2 mixed video/audio/graphics finishing, then Y2 advanced source-range assembly and Z end-to-end edit jobs.


### Module X2 — mixed professional finishing (2026-09-26)

- Added `premiere_finish_media_batch` / `premiere_finish_media_batch_cancel`: one bounded job can now apply exact per-clip video motion/color recipes, exact per-parameter audio automation, and an optional saved V2 graphics batch. Existing native planners/executors are reused; no duplicate low-level editing path was introduced.
- Existing video/audio clips require one fresh exact expectation each. The workflow preflights every requested recipe against the native target, takes one durable project checkpoint before the first mutation, preserves per-target applied/skipped/failed/uncertain receipts, and stops later mutation on uncertain delivery.
- Optional graphics reuse the saved mapping revision and V2 batch executor under the same checkpoint. Optional before/after review samples at most eight deterministic midpoints from actually affected video clips; review is comparative evidence, not a subjective quality guarantee.
- Speed ramps, masks, multicam and inferred linked-media operations remain unsupported. Real paired Premiere acceptance remains pending.

Conservative feature-code estimate after X2: approximately **78%**. Runtime verified remains **0%** without a paired Premiere host; production ready: **no**. Next real feature priority: Y2 advanced source-range assembly, then Z end-to-end edit jobs.
