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
