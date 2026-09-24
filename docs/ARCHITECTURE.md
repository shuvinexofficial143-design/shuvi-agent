# Shuvi architecture

## Main rule

The AI model is not the operating system. It proposes an action. Shuvi validates the proposal, applies local policy, asks the user when required, executes the local tool, captures the observation, and only then continues reasoning.

## Layers

1. Tauri/WebView2 desktop UI
2. Rust agent runtime
3. Provider adapters
4. Permission and policy gate
5. Typed computer tools
6. Tool observations
7. Local memory

## RAM policy

4 GB is a hard product ceiling for Shuvi and the child processes it manages where practical. The base app therefore avoids Electron, a bundled Python runtime, and a bundled large language model.

The meter includes Shuvi's native process and descendants of registered agent-managed processes.

## Permission model

- low: inspection/read-oriented
- medium: local writes, process launches, downloads, git writes
- high: destructive/system/account/admin operations

The first version stages every PowerShell command and requires Allow once or Deny before execution.

Later versions will support narrow session-scoped rules, not a global unrestricted bypass.

## Agent loop target

```text
user request
  -> selected provider
  -> structured tool proposal
  -> schema validation
  -> policy/risk classification
  -> permission
  -> typed tool execution
  -> observation
  -> provider continuation
  -> final result
```


## Computer-use foundation

Shuvi now separates visual understanding from semantic UI control:

- `capture_screen` creates a temporary local PNG after approval.
- `inspect_screen` sends the captured screen only to the selected vision-capable provider after a medium-risk approval.
- `ui_find` inspects the Windows UI Automation tree by exact visible name and/or AutomationId.
- `ui_click` only invokes/selects an exact, unambiguous UI Automation match.
- `ui_set_value` uses ValuePattern and does not write the entered value into the audit detail.
- `open_url` accepts only HTTP/HTTPS URLs and hands them to the operating-system browser.

Visual coordinate clicking is intentionally not used while a semantic UI Automation target is available.


## Coding mode

A user may persist one default coding workspace in Shuvi's local app-data directory. The selected path is injected into the agent system context, so phrases such as "the project" resolve to that workspace.

Coding writes remain permission-gated:

- `apply_patch` validates a unified diff with `git apply --check` before applying it.
- `run_project_task` only exposes named test/build/lint/typecheck tasks for Node.js and Rust projects.
- `git_commit` stages all repository changes and creates a commit only after explicit approval.
- `git_push` is classified high risk because it writes to a remote repository.


## UI and browser recovery

Windows UI actions can now be scoped to an exact top-level window before Shuvi searches descendants. This reduces accidental interaction with controls in another app that happen to have the same visible name.

The semantic UI layer now supports focus and ScrollPattern actions in addition to find, invoke/select and ValuePattern writes. For browser-like workflows, Shuvi should use exact window-scoped UI Automation first and screen vision only when semantic inspection is insufficient.

Tool failures are fed back into the agent loop. The system prompt explicitly prevents blind repetition of the same failed action and instructs Shuvi to refine the selector, inspect the screen, or choose another typed tool.


## Managed browser sessions

Shuvi can launch an isolated Microsoft Edge or Google Chrome window with a dedicated temporary Shuvi profile. The root browser PID is registered as a managed process, and RAM accounting walks the descendant process tree so renderer/GPU/browser subprocess memory is included rather than counting only the launcher process.

Shuvi can stop only process roots that it launched itself. Arbitrary system PIDs are rejected by the typed stop tool.


## Chromium DevTools DOM control

A managed Edge/Chrome session now starts with a localhost-only DevTools endpoint on a random port. Shuvi waits for the browser's `DevToolsActivePort` file, associates that port with the browser root PID, and exposes typed DOM operations:

- `browser_dom_read` reads up to 25 exact CSS matches and returns compact attributes/text.
- `browser_dom_click` refuses ambiguous selectors and only clicks when exactly one element matches.
- `browser_dom_set_value` focuses one exact editable element, updates its value and dispatches input/change events.
- `browser_navigate` navigates the managed page through CDP.

CDP messages are sent to the local browser debugger only. The tool never exposes an arbitrary JavaScript execution interface to the model.


## Provider retry policy

Normal text-provider requests retry up to two additional times for connection/time-out failures, HTTP 429, and common transient 5xx responses. Backoff is short and bounded (350 ms then 700 ms), so Shuvi does not create an uncontrolled retry loop or duplicate computer actions.


## Diagnostics

Shuvi can export a local JSON diagnostics report containing runtime RAM metrics, selected workspace path, managed process/browser metadata and the latest local audit entries. Credential-store API keys and other secrets are deliberately excluded.


## First-run setup

On first launch, Shuvi opens a local onboarding screen that asks the user to choose a provider and model, enter the required API key, and configure a custom endpoint when applicable. Provider secrets are written through the existing OS credential-store command; they are never saved into browser localStorage.


## Crash recovery

During an active agent task, Shuvi writes an atomic local checkpoint containing only provider/model selection and the bounded conversation/tool-observation history needed to resume reasoning. API keys are never included. Completed, cancelled, or safety-stopped tasks clear the checkpoint. On the next launch, Shuvi presents an explicit Resume or Discard choice instead of silently continuing computer actions.


## UI fallback policy

The Windows UI layer now supports TogglePattern and ExpandCollapsePattern for checkboxes, toggles, menus and expandable controls. A keyboard fallback is available only after Shuvi resolves one exact semantic UI element and focuses it; the keystroke sequence is classified high risk and its actual content is not written into the audit detail. Semantic UI patterns remain preferred over keyboard simulation.


## Premiere Pro specialization

Shuvi treats Premiere Pro as a dedicated application specialization rather than relying only on generic mouse/UI automation.

The first specialization layer now includes:
- typed Windows detection of standard Adobe Premiere Pro installations;
- a permission-gated typed Premiere launch action that can open an absolute .prproj project;
- a UXP Manifest v5 plugin scaffold targeting Premiere Pro 25.6+;
- a dockable Shuvi Premiere panel with read-only active project / active sequence inspection.

The intended final control order is:
1. Premiere-native UXP APIs for project, sequence, track, clip, effect and export operations;
2. Windows UI Automation for Premiere controls that are not exposed through UXP;
3. screen vision for state understanding;
4. high-risk keyboard or coordinate fallbacks only when semantic/native controls are unavailable.

Major timeline edits will be versioned/checkpointed before execution, and Shuvi's desktop permission/audit layer remains authoritative over sensitive changes.


## Premiere localhost bridge

The Shuvi desktop runtime hosts a loopback-only HTTP bridge on 127.0.0.1:17361. Starting the bridge rotates a random temporary pairing token. The Premiere UXP panel must present that token in the `X-Shuvi-Token` header before it can poll for commands or post results.

The bridge intentionally exposes only fixed routes (`/health`, `/command`, `/result`) and a bounded command queue. The agent does not receive the pairing token in ordinary Premiere tool observations. The native command set includes project/sequence inspection, timeline edits, effects and keyframes, recipes, media management, captions/transcripts, MOGRT insertion and export. The UXP dispatcher remains an explicit allowlist.


## Premiere timeline edit safety

Native Premiere timeline writes now use deterministic track/clip targeting exposed by the read-only timeline inspector. Insert/overwrite, trim, clip move and sequence creation are permission-gated, execute through Premiere's undoable transaction model where the API supports it, and create a timestamped sibling `Shuvi Backups` copy of the current `.prproj` before the major edit only after a saved local project is available; otherwise the edit is refused.

Timeline inspection reports stable clip indexes sorted by start time so Shuvi can inspect first, then target the intended clip rather than guessing from screen coordinates.


## Premiere export

The Premiere bridge can export the active sequence either immediately in Premiere or queue it to Adobe Media Encoder, with an optional Premiere export preset path. Export is classified high risk because it writes media files and can start a long-running encode.


## Premiere effects and keyframes

The native Premiere bridge now exposes installed video transitions and video filters by Adobe match name, reads a selected video clip's component chain, inspects component parameters, applies static parameter changes and can add time-based keyframes for parameters that advertise keyframe support.

Effect writes are high-risk typed actions. Shuvi creates a timestamped `.prproj` backup before adding transitions/effects, changing effect parameters or adding keyframes. Clip targeting stays deterministic: video track index + clip index from the sorted timeline inspector, then component index + parameter index from effect inspection.


## Premiere audio effects

The UXP bridge now mirrors the video-effect architecture for audio clips: installed audio effects can be discovered by display name, appended to a deterministic audio clip target, inspected by component/parameter index, changed for static parameters, and keyframed when the parameter supports animation. Shuvi backs up the project before audio-effect writes.

## Premiere sequence markers

Shuvi can inspect, add and remove active-sequence markers through Premiere's native Markers API. Marker reads expose deterministic indexes sorted by sequence time. Marker deletion is high-risk and creates a project backup before removal; marker creation remains permission-gated.


## Premiere project organization

The Premiere bridge can now walk the project-bin tree with bounded depth/item limits and expose stable project-item ids plus media path, offline state, proxy state and sequence state. Shuvi can rename and move project items through Premiere undoable project transactions.

Media relink and proxy attachment use Premiere's native ClipProjectItem APIs. Because those operations are not undoable in Premiere's API, Shuvi classifies them high risk and writes a timestamped `.prproj` backup before the operation.

## Premiere Motion Graphics templates

Shuvi can insert a MOGRT either from an absolute `.mogrt` file path or by Creative Cloud Library name + element name through SequenceEditor. Both variants target an explicit timeline time and track indexes, are high risk, and create a project backup first.


## Premiere parameter recipes

Shuvi can now resolve Premiere video/audio components and parameters by exact native match/display names instead of relying only on numeric indexes. Multi-setting recipes can atomically apply up to 64 named static changes and/or keyframes to one clip inside a single Premiere transaction. This is the foundation for reusable Motion/Transform, Lumetri-style grading and audio processing recipes without hardcoding one Premiere language/version's component indexes.

Recipe writes are high risk and create a timestamped project backup first. The agent should inspect the clip's native component chain before applying a recipe so it uses names actually exposed by the current Premiere installation.

## Premiere visual review

`premiere_inspect_frame` moves the native Premiere playhead to an exact time, waits briefly for the Program Monitor to update, captures the current screen and sends that image to the selected vision-capable provider. This creates a direct edit → preview → visual-analysis foundation while keeping any corrective edit as a separate permission-gated typed action.


## Premiere saved recipe library

Shuvi persists reusable Premiere video/audio parameter recipes under the app-data Premiere folder. A saved recipe contains only exact component selectors, exact parameter display names, primitive values and optional keyframe times; no API keys or project media are stored.

Recipe application is high-risk, creates a timestamped project backup, and can target one clip or a bounded batch of clips. Batch application reports per-target success/failure rather than hiding partial completion.

## Premiere batch relink and proxy workflows

Batch media relink and proxy attach validate every local file path before execution, create one project backup up front, process at most 100 project items, and return per-item outcomes. A partial failure is surfaced as an unsuccessful action with explicit notice that earlier successful items were not rolled back.

## Premiere multi-frame review

A bounded multi-frame review can move the Premiere playhead to up to eight requested timestamps, capture each screen, and ask the currently selected vision-capable provider to evaluate the same review prompt. The returned frame observations stay in the normal Shuvi agent loop so a later edit can be proposed with permission and then reviewed again.

## Premiere source preparation and transcripts

Shuvi can set or clear ClipProjectItem source in/out points and, on Premiere 26.3+, create subclips through Premiere's undoable action API. It can also request Premiere transcription for a clip project item and read a bounded transcript JSON preview for editing decisions. Transcript responses are capped before crossing the localhost bridge so very long clips cannot overwhelm the bridge payload.

## Registry validation

The validator syntax-parses the frontend and UXP panel and checks each protocol tool through the proposal allowlist, permission stage, typed action and execution arm. It detects duplicate UXP routes and missing direct/closed recipe-dispatch bridge routes. Rust checks follow this repository's explicit match-arm convention and complement cargo check; they are not a general Rust parser. Regression fixtures deliberately remove or duplicate wiring to verify detection. No model-supplied JavaScript is exposed by this work.

## Speed planning adapter

Speed requests deserialize into a closed Rust schema with bounded numeric inputs before entering the UXP allowlist. The UXP adapter reads the exact clip and delegates calculations to the pure speed-workflows.js planner. It returns project/sequence identity, clip bounds, a versioned plan and an explicit unsupported execution capability. Planning never creates a transaction or invokes UI. Source-span calculations are estimates and do not infer undocumented native speed units or reconstruct existing remapping curves.

## Required edit checkpoints

Every operation using the shared major-edit backup helper now fails closed when a saved, non-empty local .prproj cannot be backed up. The helper checks project identity/path before and after saving, streams a uniquely named copy, flushes it, detects size/mtime changes during copying and writes a versioned checkpoint.json sidecar. Existing action results retain the backup path string. A save itself may persist unsaved project changes; the subsequent timeline edit is not sent when checkpoint creation fails.

Limits: 2 GiB per source project, 1,000 .prproj backups or 20 GiB per backup folder, and a 10,000-entry scan bound. Reaching a limit stops editing and asks the user to review/archive backups; no existing backup is automatically deleted. Backup folders must resolve directly beside the project. These checks reduce project-switch risk during saving, but do not lock Premiere's active project across the later command dispatch; a complete project/sequence identity guard remains pending.

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

## Structured captions and SRT boundary

Caption parsing/serialization is isolated in `integrations/premiere-uxp/caption-workflows.js` and never edits Premiere. Structured cues use `{start,end,text}` seconds, are deterministically sorted, preserve multiline text, report overlaps, and merge only when explicitly requested. Hard limits are 1 MiB input/output SRT, 5,000 cues, 8,000 characters per cue, 512 KiB total cue text and 24 hours. Invalid, zero/negative or sub-millisecond durations fail instead of being rounded into ambiguous SRT cues.

Premiere transcript adaptation is deliberately schema-conservative. Shuvi recognizes only `segments`, `textSegments`, `transcript.segments` or `transcript.textSegments` arrays whose every item exposes explicit `start/end` or `startTime/endTime` seconds and a string `text`. Unknown or partially timed JSON returns `supported=false`; the adapter never reconstructs timings from word order or undocumented fields. Existing transcript export adds bounded segment/SRT previews so the 240 KiB bridge-response ceiling remains intact.

Reviewed Adobe Premiere UXP documentation on 2026-09-23 exposes Transcript export/import-to-clip APIs plus Sequence caption-track discovery and CaptionTrack rename/mute, but no documented native caption creation, caption text editing or SRT import action. Shuvi therefore reports `native_caption_creation=false`, `native_caption_text_editing=false`, `srt_generation=true` and an unsupported external-SRT import adapter boundary. No blind GUI fallback is used. Runtime verification against a disposable Premiere project remains pending.

## Inspected graphics property planning

Module G adds two low-risk typed Rust tools and allowlisted UXP routes. mogrt-workflows.js separates bounded read-only native inspection from pure title/lower-third planning. It never identifies a MOGRT or field role by its name: role labels come from the caller, and values must exactly match the inspected primitive type. Missing/ambiguous, complex, unreadable and animated fields cannot produce settings. Complete inspection is required to establish selector uniqueness; no native actions are created while planning.

A plan carries the existing optional project/sequence/clip expectation and named settings for premiere_apply_video_recipe. That existing high-risk path retains permissions, audit logging, required checkpoints and native transactions. Static execution re-resolves exact selectors and refuses animated parameters; native createKeyframe performs final host type validation. No separate graphics writer or GUI fallback was added. Snapshots cannot lock parameter state or prove native template editability; host edit/undo acceptance is still pending.

## Project/media diagnostics

Module I adds a single low-risk typed inspection tool. project-diagnostics.js accepts existing native cast/identity adapters, reads the active project and iteratively walks folder arrays with a depth stack rather than recursive unbounded traversal. Counts exclude the root and describe visited item occurrences; totalProjectItemCount is null when traversal is incomplete. Sequence objects are counted separately from media. Status counters include clips not positively identified as sequences, with unknownClipKind explicit. Missing paths and unreadable fields remain unknown, not guessed states.

The collector isolates field errors, detects repeated folder references, checks a cooperative elapsed-time budget between items, and caps item/detail/duplicate/error/extension/path/output sizes. Native getItems/getSequences calls return complete arrays without a documented pagination interface; Shuvi does not copy/enqueue every child, but cannot interrupt or pre-bound the host's individual allocation/call. Final payload trimming removes detail while retaining counters and truncation metadata. Windows path groups are candidate references using ASCII case/slash normalization, not file equivalence or permission to repair. Existing relink/proxy batch tools remain separate and unchanged.
# Bounded Premiere review sessions (Module J)

The desktop owns `premiere_review_session_start/status/next/record_fix/cancel`. Sessions are local JSON in the application data directory, keyed by generated UUID; screen captures and base64 never enter the session JSON. The next action checks the project and sequence GUID, inspects at most four fixed timestamps, accepts only bounded structured JSON from the vision provider and records an issue summary. The total provider-call budget is 32 per session. Re-review at the same timestamps compares actionable issue counts and confidence; it cannot assert pixel-level or subjective quality.

The editorial planner is a separate version 1 recipe schema in `premiere_editorial.rs`. It validates a bounded, ordered stage graph and synthesizes one of eight fixed packs. Its output is read-only, with typed capability names and missing-input reports. Known unsupported stages stay blocked. There is no dynamic execution of stage parameters; the agent must choose one existing typed Premiere tool per mutating stage and obtain its normal approval, project checkpoint and target expectation. Module J supplies review checkpoints. Saved single-parameter video/audio recipes use their existing schema and tools.

Premiere export preflight uses desktop filesystem checks plus the UXP `inspect_export` read-only route. The resulting project/sequence expectation is required by the high-risk `premiere_export_sequence` tool, rechecked immediately before dispatch and enforced in the panel. The export response reports native acceptance or AME queue acceptance; independent file observations cannot confirm finished encoding. On transport uncertainty Shuvi returns `execution_status_unknown` with automatic retry disabled. An existing output requires explicit high-risk overwrite intent.

Premiere acceptance evidence is a separate bounded local version 1 report. Each capability has independent `code_tested` and `premiere_runtime_verified` fields. Node tests and planner existence cannot promote runtime state. The desktop's read-only Group 1 probe verifies paired UXP context identity, a timeline with matching expectation, and bounded project diagnostics before recording host version, project/sequence GUID and the five successful action categories. Other groups refuse automatic destructive probing until disposable status can be established; a local report is not an externally attested certificate. Persistence is atomic with a recoverable backup and a strict 96 KiB/64-evidence ceiling.

Every vision suggestion is marked unsupported for direct execution until a human or agent inspects an exact clip and parameter through existing typed planners. The existing mutating Premiere tools keep their approval, checkpoint, expectation and audit flow. A session can record a fix only when its ID appears in the recent successful typed-action audit log. The recorded settings fingerprint is advisory; the current audit entry does not bind the full write payload to that fingerprint. Cancellation is checked between frame calls and before saving the review.
Premiere acceptance registration is a separate bounded atomic `disposable-v1.json` record under application data. `premiere_acceptance_register_disposable` needs an explicit disposable declaration, high-risk approval, saved absolute `.prproj` and a live matching host identity. `premiere_acceptance_plan` rechecks that identity and returns at most twelve ordered typed steps for groups 1–8. Mutation is handed to the existing typed tool permission, checkpoint, expectation and audit pipeline one action at a time; the planner never dispatches UXP mutation or promotes the runtime matrix.
Review target binding loads the persisted latest review issue, checks its timestamp against the session samples and issue frame list, and inspects the native timeline afresh. Overlapping clips remain explicit. Exact signature, project and sequence GUIDs are required; incomplete timeline/parameter inspection fails closed. Native component and parameter names are taken from Premiere inspection, never vision text. Binding returns a project/sequence/clip expectation and a known typed planner family, without a command dispatcher or mutation.
Graphics binding enumerates at most 16 editable primitive native properties from a complete inspection and requires an exact component/parameter selector. A string value is a native primitive observation, not proof of an Essential Graphics text role or MOGRT identity; the caller supplies role and desired value to the existing typed graphics planner.
Professional edit sessions reuse the version 1 Module K `Recipe` and preserve each stage's dependency and blocked reason separately from run state. A bounded atomic local record stores project/sequence identity, at most 32 stages and 64 events. `premiere_edit_session_next` refreshes host identity and only proposes the next eligible typed tool. `record_action` checks a recent successful or failed audit receipt with the required tool and session creation time; it does not dispatch the tool. Review stages require an existing completed Module J session on the same project and sequence, with matching sample positions when specified; unresolved medium/high issues fail the stage and point to Module Q binding. Audit receipts currently do not cryptographically bind the entire stage payload, so a successful stage receipt remains procedural evidence rather than proof of editorial quality.
