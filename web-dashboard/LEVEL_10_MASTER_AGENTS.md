# Shuvi Web Dashboard — Level 10 Master Agent / Worker Console

Implementation branch: `ui-dashboard`, frontend in `web-dashboard`.

## Implemented

A dedicated **Agents** page appears in the left navigation (shortcut `Alt+4` in the nine-item menu).

- Topology overview: **Master Agent → Task Planner → Worker Candidates**.
- Six specialist **planning profiles**: Blender, Premiere Pro, After Effects, Coding Workspace, Browser & Windows, Photoshop.
- Clickable worker cards with domain descriptions and **resource lock** hints.
- Browser-only delegation builder: select an existing saved task draft, choose a worker, optionally add bounded instructions, and save.
- Persist delegation plans in browser storage (`shuvi.web.master-delegation.v1`). Validate worker ID, task ID, timestamp and maximum 240-character instructions; deduplicate and bound stored plans to 30.
- Remove a saved plan without touching real tasks. If the referenced draft is deleted, show a **source task removed** warning.
- Live sync with existing task draft creation and deletion, activity timeline, and same-origin storage events.
- Display explicit **Not connected** for workers and unavailable markers for native active job and approval counts.
- Theme-aware, keyboard-accessible and responsive layout for existing Sapphire, Violet, Teal and Steel palettes.

## What is not implemented

**This screen does not dispatch workers, call models, install software, move the mouse, or approve any action.**

Native multi-agent execution needs separate, separately verified phases:

1. Authenticated Shuvi desktop-to-web bridge, with explicit origin verification and session revocation.
2. Rust task IDs with persistent queue, execution state and audit receipts.
3. Master command router and worker registry tied to real app/runtime health checks.
4. Shared Windows input lock plus application/project-specific editing locks and resource fairness.
5. Explicit native approval gate and separation of read-only inspection and mutating actions.
6. Safe restart recovery, redacted per-worker event stream, screenshot permissions and validated result evidence.

A source module or website control is **not** proof of successful execution in Blender, Premiere, Adobe or the Windows shell.

## Local review

Pull from `ui-dashboard` (do not reset other branches or overwrite local edits):

```powershell
cd C:\Users\shuvi\shuvi-agent
git pull --ff-only origin ui-dashboard
cd web-dashboard
npm test
npm run build
npm run dev -- --host 127.0.0.1 --port 1422 --strictPort
```

Reuse an already-running Vite server if it occupies 1422 instead of launching another.

Open the Vite URL in Chrome, select **Agents**. If no drafts exist, go to **Tasks** and save one. Return to Agents and save a delegation to Blender Worker or Premiere Worker. Confirm the plan appears as **PLANNED**, not Running, and that removal works. Creating and deleting plans will also be recorded as **browser-only planning activity**.

## Next Level 11

Project Workspace: per-project task and asset association, safe metadata snapshots, and design for verified native file/asset boundaries. Keep web previews separated from real local execution.
