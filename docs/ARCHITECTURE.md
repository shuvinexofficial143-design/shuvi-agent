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

The current v0.1 meter covers Shuvi's own native process. Process-tree accounting is planned for v0.2.

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

The bridge intentionally exposes only fixed routes (`/health`, `/command`, `/result`) and a bounded command queue. The agent does not receive the pairing token in ordinary Premiere tool observations. The current native command set includes project/sequence inspection, top-level project-item listing, and permission-gated media import.


## Premiere timeline edit safety

Native Premiere timeline writes now use deterministic track/clip targeting exposed by the read-only timeline inspector. Insert/overwrite, trim, clip move and sequence creation are permission-gated, execute through Premiere's undoable transaction model where the API supports it, and create a timestamped sibling `Shuvi Backups` copy of the current `.prproj` before the major edit when a normal project path is available.

Timeline inspection reports stable clip indexes sorted by start time so Shuvi can inspect first, then target the intended clip rather than guessing from screen coordinates.


## Premiere export

The Premiere bridge can export the active sequence either immediately in Premiere or queue it to Adobe Media Encoder, with an optional Premiere export preset path. Export is classified high risk because it writes media files and can start a long-running encode.


## Premiere effects and keyframes

The native Premiere bridge now exposes installed video transitions and video filters by Adobe match name, reads a selected video clip's component chain, inspects component parameters, applies static parameter changes and can add time-based keyframes for parameters that advertise keyframe support.

Effect writes are high-risk typed actions. Shuvi creates a timestamped `.prproj` backup before adding transitions/effects, changing effect parameters or adding keyframes. Clip targeting stays deterministic: video track index + clip index from the sorted timeline inspector, then component index + parameter index from effect inspection.
