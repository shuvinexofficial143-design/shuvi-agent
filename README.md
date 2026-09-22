# Shuvi

**Shuvi** is a lightweight, permission-first Windows AI computer agent.

## Goals

- Run comfortably on an 8 GB Windows laptop.
- Keep Shuvi's own memory usage well below the 4 GB hard ceiling.
- Let the user choose their AI provider instead of locking the app to one company.
- Perform real computer tasks only with explicit permissions for sensitive actions.
- Ship as a normal single-click Windows installer.

## Planned providers

- DeepSeek
- OpenAI
- Gemini
- Anthropic Claude
- OpenRouter
- Ollama / local OpenAI-compatible servers
- Custom OpenAI-compatible endpoints

## Core architecture

```text
Tauri desktop UI
      |
Agent runtime (Rust)
      |
Provider abstraction
      |
Planner / tool dispatcher
      |
Permission gate
      |
Files | PowerShell | Apps | Browser | Screen
      |
Audit log + local memory
```

## Memory budget

Shuvi is designed around a strict process budget:

- idle target: < 300 MB
- normal agent session target: < 1 GB
- browser / coding workflow target: < 3 GB
- soft cleanup threshold: 3.5 GB
- hard agent ceiling: 4 GB

Heavy optional child processes are tracked separately and should be stopped or rejected before the budget is exceeded.

## Security model

- API keys must not be committed to the repository.
- Provider secrets are stored using the OS credential store.
- Destructive file operations, shell commands, installs, credential access, uploads, and external writes require permission.
- Every tool call is logged locally.
- "Allow once", "Allow for this session", and "Deny" are first-class concepts.

## Development status

Foundation scaffold in progress.
