# Shuvi Premiere Bridge

Native command bridge for Shuvi's professional Adobe Premiere Pro integration.

Current scope:
- UXP manifest v5
- Premiere Pro 25.6+ host target
- dockable Shuvi panel
- read-only active project / active sequence inspection
- permission-gated timeline, project, effects, audio, graphics and export operations

Architecture:
1. Shuvi desktop agent remains the permission/risk/audit authority.
2. The UXP plugin performs Premiere-native project/timeline operations.
3. Typed commands cover imports, bins, sequence edits, effects, captions, audio and export; unsupported operations must fail explicitly.
4. Before destructive or large timeline changes, Shuvi will create a version/checkpoint and ask for permission where appropriate.

During development, load this folder with Adobe UXP Developer Tool while Premiere Pro developer mode is enabled.


## Current native command bridge

Implemented typed bridge commands:
- inspect active project / active sequence
- inspect video/audio tracks and clip timing
- list root project items
- create root bins using Premiere undoable transactions
- import media
- create a sequence from media
- insert or overwrite media at an exact sequence time/track
- save the active project

Shuvi's desktop agent creates a timestamped sibling `Shuvi Backups` copy of the current `.prproj` before major sequence creation and insert/overwrite edits only after a saved local project is available; otherwise the edit is refused.

- trim exact video/audio clips by track + timeline clip index
- move clips on the same track by a signed time delta

- delete or ripple-delete exact clips by deterministic track/clip index
- export the active sequence immediately or queue it to Adobe Media Encoder, with an optional export preset

- discover installed video transitions and effects by Adobe match name
- inspect a video clip's effect/component chain and parameter indexes
- add video effects and transitions through Premiere transactions
- set non-time-varying effect parameters
- enable time-varying parameters and add effect keyframes

- discover and add native audio effects by Premiere display name
- inspect audio effect chains, change static parameters, and add keyframes
- list/add/remove sequence markers for edit planning, review notes and beat/scene cues

- inspect the recursive project tree with stable ids, media/offline/proxy state
- rename and move project items between bins
- relink clip media and attach proxies with desktop-side backup protection
- insert Motion Graphics templates from .mogrt paths or Creative Cloud Libraries

- set video/audio effect parameters by exact component + parameter names
- keyframe video/audio parameters by exact native names
- apply atomic named video/audio parameter recipes for grading, transform and mix workflows
- perform adjacent-clip rolling edits with project backup protection
- inspect an exact Premiere playhead frame through Shuvi's selected vision provider

- save/list/delete reusable local video or audio parameter recipes and apply them to one or many clips
- batch relink offline media and batch attach proxies with per-item results
- review up to eight Premiere frames with Shuvi vision at explicit playhead timestamps
- set/clear source in/out points and create Premiere 26.3+ subclips
- transcribe clip project items and read a bounded transcript JSON preview

- list supported transcription languages and import transcript JSON
- discover caption tracks, rename tracks (26.3+ API guarded), and set track mute
- parse/serialize bounded SRT, adapt explicitly timed transcript JSON to structured captions, and report native caption-import capability honestly
- create a subsequence from explicit video/audio clip targets while restoring selection
- insert/overwrite a project item, including a sequence project item
- clone clips with native time and track offsets

## Verification

Run npm run validate, npm test and npm run build from the repository root. Validation syntax-parses this panel and checks its routes against desktop requests. Tests use source fixtures/mocks; they do not prove Adobe runtime compatibility. Full disposable-project Premiere verification is pending. The Rust toolchain was unavailable locally during the 2026-09-23 continuation; see Windows CI for cargo check.

## Speed workflow boundary

premiere_inspect_clip_speed returns native speed/reverse and source/sequence bounds. premiere_plan_speed accepts a typed request with mode rate, duration, preset, ramp or freeze and returns a reviewable plan only. Omit fields belonging to other modes. Rate is a source-time multiplier; ramp points use increasing source_offset_seconds spanning the inspected source range. Ramp duration integrates a rate that varies linearly in source time. This does not reproduce Premiere time-remapping curves.

Plans always return applied=false and executable=false. Pitch preservation and reverse are recorded intent, not implemented edits. Adobe's reviewed [video clip](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/videocliptrackitem) and [audio clip](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/audiocliptrackitem) references expose speed/reverse getters but no speed-changing action (reviewed 2026-09-23). Native writes need a separately validated adapter and the existing high-risk permission/checkpoint path.

## Required edit checkpoints

Every operation using the shared major-edit backup helper now fails closed when a saved, non-empty local .prproj cannot be backed up. The helper checks project identity/path before and after saving, streams a uniquely named copy, flushes it, detects size/mtime changes during copying and writes a versioned checkpoint.json sidecar. Existing action results retain the backup path string. A save itself may persist unsaved project changes; the subsequent timeline edit is not sent when checkpoint creation fails.

Limits: 2 GiB per source project, 1,000 .prproj backups or 20 GiB per backup folder, and a 10,000-entry scan bound. Reaching a limit stops editing and asks the user to review/archive backups; no existing backup is automatically deleted. Backup folders must resolve directly beside the project. These checks reduce project-switch risk during saving, but do not lock Premiere's active project across the later command dispatch; optional dispatch-time project/sequence/clip expectations are now available (see below).

## Bridge lifecycle limits

The bridge still binds only 127.0.0.1:17361 and keeps the existing command/result JSON fields. Both desktop and UXP have explicit native action allowlists checked for consistency. Pairing rotates on start and expires after eight hours; restart/pair again after expiry. Restart/stop clears outstanding commands.

At most 32 commands may be outstanding, including dispatched work and unconsumed results. Only an issued, dispatched, unexpired ID can complete once. Unknown, early, duplicate and late results receive HTTP 409. Cancelling/dropping a desktop request removes its queue entry; an edit already dispatched into Premiere cannot be rolled back or interrupted by this mechanism. Timeout/reconnect errors therefore require inspection before retrying.

Limits: 16 simultaneous client handlers; 16 KiB headers; 256 KiB HTTP bodies/responses; 240 KiB desktop commands and panel result bodies; 2-second request read deadline/socket write timeout; command deadlines capped at 300 seconds. Content-Length must be valid and unambiguous; chunked and truncated requests are rejected. Oversized/unserializable results return a small uncertainty error. The panel snapshots the token for each command and never posts a contradictory execution failure merely because delivery failed.

Node transport mocks cover delivery loss, re-pair/unpair and Unicode/cyclic payloads. Rust queue/parser/token tests are included in Windows CI; local execution and real Premiere reconnect/timeout verification remain pending.

## Named keyframe lifecycle

premiere_inspect_keyframes accepts a typed video/audio target using exact component match/display names and parameter display name. It returns up to 256 native tick positions, a total/truncation flag and a targetSignature. Lists above 10,000 keys are rejected. Copy exact ticks and the signature into premiere_edit_keyframe to remove one key or set linear/hold/bezier interpolation. Tick positions stay in Premiere's native parameter time domain; Shuvi does not guess timeline/source offsets.

Writes require high-risk approval, a successful .prproj checkpoint, one unambiguous named parameter, a matching project/sequence/media/clip-bound/parameter signature and exactly one existing native tick. Operations use one undoable native transaction. The signature detects common stale targets; it is not a globally stable clip UUID or a lock across asynchronous inspection. Existing add-keyframe tools remain available. Keyframe value replacement, effect lifecycle and mask APIs remain separate pending work.

The implementation uses Adobe's [ComponentParam](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/componentparam), [InterpolationMode constants](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/constants/) and [Guid.toString](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/guid) documentation reviewed 2026-09-23. Context/sequence IDs are now serialized as native GUID strings rather than opaque objects. Twelve mocked UXP tests cover keyframe inspection, video/audio and range removal, interpolation, transition removal, stale/missing/unsupported targets, ambiguity and failed transactions; real Premiere verification is pending.

Keyframe inspection also returns a bounded current value and known temporal interpolation when readable; unavailable/oversized values are explicit. premiere_remove_keyframe_range accepts native parameter seconds with 0 <= start < end <= 86400, an exact expected_count of 1–256 and the inspected signature. It removes enumerated native keys in [start,end) in one transaction. Removing the entire parameter's keyframe set requires explicit allow_remove_all=true shown in the high-risk permission detail. This uses exact per-key actions instead of assuming the native range action's endpoint inclusion.

premiere_remove_video_transition removes only the requested start or end from an exact video track/clip index, after high-risk approval and a required checkpoint. It uses the documented createRemoveVideoTransitionAction with the native START/END constant. The result confirms transaction acceptance, not independent inspection of transition presence/details. Missing native APIs/constants and failed transactions are surfaced. Existing add-transition behavior remains available.

## Optional target expectations

Native Premiere tool arguments may include expected with project_guid, optional project_path and sequence_guid, and clips (up to 64 unique {kind, track, clip_index, signature} entries). Start with premiere_timeline's expected object, then populate clips using the targeted items' targetSignature values. A null signature means native identity could not be read and cannot be used as a clip guard. Include both clips for a roll edit and every selected clip for subsequence creation. Project/sequence-only guards are allowed; omitted expected preserves existing behavior.

The desktop checks capability targetExpectations=1 before every guarded request and carries the same expectations through checkpoint saves and the edit. Reload the updated UXP panel before using this feature. The panel validates expectations before dispatch, and rechecks project/sequence when handlers acquire the project. Changed targets fail with a request to inspect again; never silently remove guards to retry.

Clip signatures include project GUID/path, sequence GUID, kind/track/index, media ID, name and native start/end/in/out ticks. They detect replacements/reordering/timing changes that alter those fields, but cannot distinguish otherwise identical instances or provide an atomic lock against concurrent human edits during asynchronous native calls. This is an optional stale-state check, not a stable native clip identifier. Node mocks cover accepted guards, project/path/sequence/clip mismatch, target coverage and state cleanup. Rust tests and real Premiere verification remain pending.

## Timeline capability and selection boundaries

premiere_timeline_capabilities is read-only. It reports the active sequence's native clone and subsequence method presence separately from runtime verification. Dedicated vertical move, linked-group inspection, replacement nesting and multicam are explicitly unsupported in Shuvi; semantic_ui_optional is an adapter boundary only, with fallbackImplemented=false. Existing vertical clone remains a copy and must target an existing same-kind track. It reports destinationTrack and does not assert which linked counterparts the host handles.

Timeline items expose selected=true/false or null when unavailable. linkedGroup is explicitly unsupported; common media IDs or coincident timing are not treated as native links. Subsequence results retain selectedClipCount for compatibility, add requestedClipCount, selectionRestored and selectionSemanticsVerified=false. Selection restoration is attempted even when assigning the temporary selection fails. The created subsequence is not represented as a verified selected-only replacement nest.

Reviewed September 23, 2026: [SequenceEditor](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequenceeditor), [Sequence](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequence), [TrackItemSelection](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/trackitemselection), [VideoClipTrackItem](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/videocliptrackitem). Host verification remains pending.

## Effect lifecycle

premiere_inspect_effect_lifecycle takes target={kind,track,clip_index,component_match_name?,component_display_name?}; at least one exact component name is required. It resolves one component and returns targetSignature plus removal capability. premiere_remove_effect takes the same target and expected_signature copied from inspection. A changed clip or ordered chain, duplicate matching names, oversized chain or unavailable removal action is rejected. Removal requires the normal high-risk permission/checkpoint path and uses one native transaction. The response confirms transaction acceptance; inspect the chain and verify undo in Premiere before treating the feature as runtime validated.

The signature is a conservative snapshot, not a stable native component UUID. Identical replacement components may be indistinguishable. enabled=null and enableDisable.supported=false avoid inventing state/actions; native preset import is unsupported, while existing named-parameter recipes remain available.

Removal is documented for [VideoComponentChain](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/videocomponentchain) and [AudioComponentChain](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/audiocomponentchain). The reviewed [Component API](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/component) exposes names and parameters, not an enable/disable lifecycle action. References reviewed September 23, 2026.

## Motion and curated color recipes

premiere_plan_video_recipe accepts track, clip_index and request={preset,bindings,start_seconds?,end_seconds?,strength?}. It inspects each exact component/parameter selector and returns settings, skipped roles, warnings and an optional expected guard. Planning never edits. Review the result, persist it through the existing recipe library if desired, then use premiere_apply_video_recipe with the returned settings and expected. Inspect resulting keys and use the existing frame-review tools afterward; frameReviewRequired is an explicit workflow requirement, not a claim that visual review has run.

Bindings supply role, component_match_name and/or component_display_name, and param_display_name. Motion bindings require start_value/end_value in the parameter's native units (scalar or two-number vector); start_seconds/end_seconds use native parameter time, not assumed timeline time. Presets: zoom_in, zoom_out, push_in, pull_out, slide_left, slide_right, ken_burns, fade_in, fade_out, handheld and static_transform. Roles include position, scale, rotation, anchor, opacity and crop. Handheld uses a fixed bounded seven-sample pattern, not random motion or motion tracking. Static transform uses start_value only. Interpolation remains the native default/existing behavior and requires inspection.

Color presets: natural_correction, cinematic_contrast, warm_cinematic, cool_cinematic, soft_wedding, high_contrast_reel, neutral_product and social_media_punch. Map their contrast/saturation/temperature/highlights/shadows roles to actually inspected Lumetri selectors. Each color binding needs an explicit positive unit and native min/max; the planner applies a bounded relative offset to the inspected scalar current value. It does not infer native units, calibrate footage, add Lumetri or promise automatic correction. Unavailable roles and already-animated static parameters are skipped with reasons. Empty settings means nothing can be applied. Native look/units and Premiere runtime verification remain pending.

## Audio automation and ducking boundary

premiere_plan_audio_automation accepts an exact named audio target and request. mode is duck, fade_in, fade_out or pan. Supply duration_seconds, baseline matching the inspected current value, and value_unit=db, linear_amplitude or native. Ducking takes regions=[{start,end}], attack_seconds/release_seconds (positive, at most 30 seconds), and either reduction_db (0–60, known dB/amplitude units only) or target_value. Native units require explicit min/max. Other modes take target_value; direction is checked for fades. Timing must already be mapped to the target parameter's native seconds; no timeline/source conversion is guessed.

The planner rejects unsupported keyframes, already-animated parameters, stale baselines and invalid values. Ducking merges overlaps and gaps whose attack/release envelopes overlap, holding the reduced level across those gaps. Boundaries are clipped to the supplied duration; an interval ending at duration stays ducked rather than adding an instantaneous recovery. Limits are 128 regions and 64 output keys.

Results contain settings and expected for the existing premiere_apply_audio_recipe/checkpoint workflow, and can be saved in the existing audio recipe library. Planning is separate from execution. Inspect the actual Volume/Gain/Pan component parameters first; the supplied value_unit is not autodetected. Interpolation follows native defaults and requires post-apply keyframe inspection and listening. Dialogue input is supplied, automaticSpeechDetection=false; no speech analyzer or automatic mixing is claimed.

## Structured captions / SRT

`caption-workflows.js` provides the pure caption layer. Cues are `{start,end,text}` in seconds. SRT parsing handles BOM, LF/CRLF/CR, multiline text, strict timestamps, deterministic sorting and overlap reporting. Serialization re-numbers cues and emits sorted timing. Merge behavior is off by default and runs only when `mergeAdjacent=true` is explicitly requested. Hard limits: 1 MiB file, 5,000 cues, 8,000 characters per cue, 512 KiB cue text and 24 hours.

Transcript adaptation is intentionally conservative because Adobe documents `Transcript.exportToJSON` but not a stable public JSON schema. Shuvi only adapts recognized segment arrays when every cue contains explicit start/end seconds and text. Otherwise it returns `supported=false` and leaves the transcript available for inspection. `premiere_export_transcript` now includes bounded caption/SRT previews when adaptation is safe.

Adobe UXP docs reviewed 2026-09-23 expose caption-track discovery, name and mute plus transcript APIs, but no documented native caption creation, caption-text editing or SRT-import action. The capability object therefore reports native creation/editing/import unsupported and SRT generation supported. Import remains an explicit external-SRT boundary; do not replace this with blind UI clicks.

## Inspected graphics / MOGRT properties

premiere_inspect_mogrt_properties takes {track,clip_index} and reads the exact video clip's generic component chain. It returns clip name/native match name when exposed, bounded component/parameter names and counts, primitive start values/types, keyframe support, time-varying state and static setter availability. Complex values (including objects/arrays), non-finite numbers and strings above 2048 UTF-16 units are unavailable for primitive editing. Native MOGRT identity and semantic field roles are explicitly false; a parameter called Text/Title is never treated as text unless its actual native value is a string.

premiere_plan_mogrt_recipe takes the same target and request={preset,fields}. preset is title or lower_third. Each field supplies role=text|title|subtitle|property, component_match_name and/or component_display_name, param_display_name, and a string/finite-number/boolean value. Selectors must be exact and unique. Text/title/subtitle roles require string-to-string updates. Property roles require the same primitive type; no conversion occurs. Unsupported/missing/ambiguous/time-varying fields appear in skipped. Duplicate selectors (including aliases to one native parameter), excessive fields and oversized input fail the plan. Empty settings means nothing is ready to apply.

Planning returns applied=false, semanticFieldInference=false, settings and expected. Copy settings/expected into the existing premiere_apply_video_recipe after review; its normal high-risk permission, checkpoint, audit and transaction requirements remain unchanged. Inspect and visually verify the result and undo on a disposable template. Planning does not create actions, add graphics or modify Premiere. A field's native methods being present does not guarantee that a particular template permits a write.

Limits: 128 components, 128 parameters/component, 256 total inspected parameters, 16 requested fields, 240-character selectors, 2048-character values and 48000 serialized characters for inspection/plans. Incomplete inspection is explicit and produces no settings. Reviewed September 24, 2026: [VideoClipTrackItem](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/videocliptrackitem), [Component](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/component), [ComponentParam](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/componentparam). No documented reliable isMogrt/semantic-field getter was found in these APIs.

## Bounded project/media diagnostics

premiere_project_diagnostics optionally takes limits={max_items,max_depth,max_detail_items}; defaults/hard maxima are 10000, 32 and 200. It is read-only and returns project/activeSequence metadata, totalSequenceCount, counts, extensions, mediaDetails, duplicatePaths, repeatedItemIds, errors, traversal and truncation. Counts exclude the root. totalProjectItemCount is null when traversal is incomplete; counts.projectItems remains the visited occurrence count. Inspect countsScope, inspectedFieldsComplete, unknown status counts and detailCounts before interpreting a report as complete.

Offline/proxy details include native item ID/name, media path, bin location, offline status, attachment/path and proxyUsable=null. An offline original with an attached proxy is counted separately but never represented as having a usable proxy. Unknown paths are not proof of offline media. Sequence project items are excluded from media status summaries; unknown clip kind is explicitly included as a candidate. Extension counts come only from returned media paths, never display names.

Duplicate groups use absolute paths. Windows drive/UNC paths compare slash direction and ASCII case; POSIX case remains significant. Relative/device paths are not grouped. No dot/junction/Unicode normalization or filename-only comparison is performed. Case-sensitive Windows directories can produce false-positive candidates, so groups are candidateOnly=true. Repeated item IDs are a separate reference diagnostic, not proof of duplicate media. No deletion, relinking, proxy attachment or other repair occurs.

Further limits: 50 duplicate groups per list, 8 sample members/group, 32 error details, 2048-character paths, 64 extension keys (overflow aggregated as other), 24000 media-detail serialized characters and 48000 final serialized characters. Group totals and omitted-detail counts survive output trimming. The 10-second time limit is cooperative between items; an individual native call cannot be cancelled or paginated by this adapter. A host folder array may be large, but Shuvi does not create a second all-children work queue. Cycles, failures and limits produce partial reports, not false whole-project totals.

Reviewed September 24, 2026: [ClipProjectItem](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/clipprojectitem), [FolderItem](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/folderitem), [ProjectItem](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/projectitem). Native project testing remains pending.
# Desktop review sessions

The Premiere panel continues to expose only its existing typed inspection and edit routes. Shuvi's desktop review session calls `inspect_context` and `set_playhead`, captures at most four screen frames per iteration, and stores bounded structured observations locally. It never sends model output to a UXP action. A proposed adjustment requires exact target/parameter inspection followed by a normal approved, checkpointed typed edit, then `premiere_review_session_record_fix` and `premiere_review_session_next`. Only a disposable project should be used for host acceptance until Premiere runtime verification is complete.

The separate `premiere_plan_edit_recipe` desktop tool creates a versioned read-only editorial plan. All eight packs rely on existing UXP typed routes; no new panel command or arbitrary action dispatcher is involved. Exact project/sequence/clip signatures, supplied timings/assets and inspected parameter bindings must be present before the corresponding stage is marked ready. Unsupported native capabilities stay blocked.

Export uses `inspect_export` to read project/sequence identity and `EncoderManager.isAMEInstalled`. Desktop preflight checks output and preset paths and returns the exact expectation required for `export_sequence`. The panel never reports rendering complete from the boolean `EncoderManager.exportSequence` result: immediate calls are accepted, AME calls are queued, and `completionVerified` remains false until a separately verified completion signal is implemented. Failed result delivery or expiry may mean the export ran; inspect before retrying.

The desktop acceptance report starts every coded capability as unverified. Read-only Group 1 can exercise `inspect_context`, `inspect_timeline`, and bounded `project_diagnostics` on a paired Premiere host; only consistent live results become runtime evidence. Groups 2–8 require a disposable test project and separate safe harnesses before any destructive test. Node/mock tests do not count as Adobe host acceptance.

Official reference reviewed for remaining capability boundaries: [SequenceEditor](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequenceeditor), [VideoClipTrackItem](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/videocliptrackitem), [CaptionTrack](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/captiontrack), and [EncoderManager](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/encodermanager). Clone vertical offset is documented; a general track move, native caption edit/import and speed write were not found in those reviewed methods. These remain unsupported until verified against specific documented APIs.
Disposable acceptance registration is performed by the desktop after a live `inspect_context`; the UXP panel does not infer disposable status from project names. The bounded group planner supplies existing typed tool names and safety requirements. Mutating host acceptance is not run as a bulk panel command. Registration alone is not permission to edit or proof that any capability is runtime verified.
The desktop review resolver reads the panel's existing `inspect_timeline` clip signatures and exact `inspect_clip_effects`, `inspect_audio_clip_effects`, or `inspect_mogrt_properties` outputs. All overlapping clips are candidates. The desktop binder refuses ambiguous native components/parameters, stale signatures and unsupported caption/continuity edits; it does not create a new UXP mutation route.
Professional recipe runs are desktop state only: no new UXP mega-executor was introduced. The desktop selects one stage from the existing editorial packs, waits for the existing typed tool's approved audit receipt, then uses a bounded review session when required. Stale host identity, incomplete review, missing inputs and unsupported operations prevent automatic progression.

Module S uses existing typed panel actions only. Group 2 trim/move/clone acceptance may be prepared for one explicitly registered disposable project and launched after separate high-risk approval. The desktop requires a checkpoint and native timeline post-inspection. A native result or project backup alone never proves recovery, and no other group is silently promoted from this narrow fixture.

Native parameter calibration uses existing `inspect_clip_effects` / `inspect_audio_clip_effects` and exact named setter routes. Static numeric delta probing and restoration require a registered disposable project, high-risk permission, .prproj checkpoint and clip expectation. No panel-side arbitrary calibration action or inferred Lumetri/audio unit was added. A numeric delta/recovery result is not a verified semantic role; complex PointF and unsupported interpolation stay unverified.

Export status is owned by the desktop's bounded local job store. The panel still returns accepted/queued only. Although current Adobe EncoderManager documents AME render events, their output/job correlation was not established by the reviewed reference, so Shuvi reports file existence and stable metadata separately from `encoder_completion_verified=false`. `premiere_readiness_report` cannot make the project production ready without real disposable-host acceptance and recovery evidence.

## Premiere subtitle delivery and inspected graphic population (Module V)

- `premiere_write_srt` writes validated UTF-8 captions to an absolute `.srt` file under an existing directory. Existing files require explicit overwrite approval; cues and text are bounded. `premiere_transcript_to_srt` reads real Premiere transcript segments and writes only complete recognized timing (at most 256 cues/60,000 characters per bridge delivery); unknown or oversized schemas fail without a partial file. Native Premiere caption creation remains unsupported.
- `premiere_populate_mogrt` accepts user-supplied exact native component/parameter selectors and a fresh clip expectation, re-plans against the inspected host, refuses ambiguous or incompatible fields as a group, takes a `.prproj` checkpoint and applies the typed video parameter recipe. A supplied MOGRT still needs the existing `premiere_insert_mogrt_path` action; batch insertion and persistent template mapping remain outstanding. No semantic role is inferred from native display names.

### Transcript-driven dialogue ducking (Module W)

- `premiere_plan_transcript_ducking` exports the actual recognized transcript, maps explicit segments into an inspected music parameter domain using caller-supplied offsets, optionally merges gaps up to five seconds, and returns native keyframe settings from the existing audio planner. `premiere_apply_transcript_ducking` redoes the same live inspection, requires an exact audio clip expectation and high-risk permission, checkpoints the `.prproj`, then applies the existing typed audio recipe. No VAD, inferred timeline offsets, assumed dB unit or loudness normalization. Fades remain available through `premiere_plan_audio_automation` and `premiere_apply_audio_recipe`; selected transcript markers and cut batch tools remain outstanding.

### Explicit multi-clip finishing (Module X)

- `premiere_batch_finish` accepts up to 32 caller-selected video clips, each with its own existing curated motion/color recipe request and inspected clip signature. It re-plans each against the live native parameter, rejects skipped bindings per clip, takes one mandatory `.prproj` checkpoint before its first edit, applies the existing typed video recipe under a high-risk approval, and returns individual applied/failed/uncertain results. `premiere_batch_finish_cancel` stops between clips. Uncertain delivery stops the batch; no blind retry. Review is recommended after the batch, not automatically inferred as successful. Audio and graphics multi-clip finishing and automatic visual sample selection are still pending.

### Explicit timeline assembly (Module Y)

- `premiere_plan_assembly` checks up to 64 exact supplied project clip IDs against the paired host, active project/sequence and existing track counts; `premiere_apply_assembly` takes a high-risk approval, requires fresh project/sequence identity and checkpoint, then invokes existing native insert/overwrite per shot. Higher existing video tracks support explicit B-roll placement. Up to 32 explicit Chapter markers are added only when all shots succeeded. The action returns per-shot results and a bounded post-edit timeline; `premiere_cancel_assembly` stops between edits. Source in/out within this batch, inserted graphics, transition chaining, ducking and inferred beat sync remain unsupported. Create an explicit subclip first if a source range is required, then supply its ID.

### V2 batch graphics

Reload the panel with `graphics-batch.js` alongside `main.js` and the existing workflow files. The desktop now provides saved/revisioned mappings, `premiere_batch_graphics`, `premiere_batch_lower_thirds`, and `premiere_cancel_graphics_batch`. Each item uses the fixed `insert_mapped_graphic` route under a project/sequence expectation and the desktop's required checkpoint. It correlates the insertion return with bounded native track observations, inspects every mapped primitive field, calls the existing video recipe/trim routes and verifies readback.

Use clear existing destination tracks. Up to 32 graphics share one desktop checkpoint. Field mismatch leaves the inserted default graphic with an explicit failure; uncertain delivery stops without retry. Requested duration only shortens video-only graphics when the documented end setter is present. No inferred template roles, linked-audio trimming, extension, complex native values or automatic rollback. [Usage and recovery](../../docs/PREMIERE_GRAPHICS.md). Real Premiere verification remains pending.
# Transcript rebuild (AA)

Premiere 26.3+ can rebuild explicit interior transcript removals into a different empty sequence using hard-bounded source subclips. The original sequence remains active and available. Reload the panel after updating to load `transcript-rebuild.js`. The desktop tools are `premiere_plan_transcript_rebuild`, `premiere_apply_transcript_rebuild` and `premiere_cancel_transcript_rebuild`; the fixed native plan/begin/step/release routes do not accept arbitrary commands. See [usage, API evidence and recovery](../../docs/PREMIERE_TRANSCRIPT_REBUILD.md). Real Premiere acceptance remains pending.
