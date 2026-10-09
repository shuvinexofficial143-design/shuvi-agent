# Shuvi Master Editor — typed worker runtime (development branch)

## Implemented in the Windows desktop source

- Master selects tools and app families from the ordinary user editing prompt. The existing native AI tool loop makes one approved proposal at a time; it is **not** a parallel pool of AI models.
- The persistent local task graph supplies dependencies and completed native action evidence. `master-worker-queue.mjs` projects Premiere, After Effects, Remotion, Blender, browser, Windows and code work from these real steps, with a resource-lane lock hint.
- A worker step is marked verified only when its expected tool has an exact successful typed-result/Rust executed audit receipt with an action UUID. In-progress jobs are never silently promoted after restart. Approval/denial/cancellation remain Rust-owned.
- The Windows app task-progress display includes worker lane and audited/ready/running/blocked counts. The browser-only Agents page remains **planning-only** and is not the runtime.
- The master prompt guides existing verified Remotion render -> multi-frame review -> final acceptance -> approved Premiere insertion. A generated plan or local path alone does not mean an asset was rendered/imported. Actual source/project verification remains required.
- A native Blender read-only inspection action `blender_inspect` is now wired to a **fixed bundled Python adapter**. It uses the separate `shuvi_blender_agent` package's `LaunchConfig`, authenticated loopback bridge and `BlenderController`.
  - Inputs: user-approved absolute Python executable, absolute Blender executable, optional existing absolute `.blend`, and operation `scene.inspect` or `system.capabilities`.
  - The helper explicitly sets `SafetyPolicy()` (no mutation, saving, file writes or rendering).
  - The native result requires a successful authenticated host response and rejects uncorrelated or malformed evidence.
  - Python 3.11+, the separately installed `shuvi_blender_agent` package, and an accessible Blender executable are required on the Windows machine. **Nothing was installed on AntCloud in this change.**
- Fixed helper is bundled as a Tauri resource, not an AI-created or user-provided Python source string. Rust always stages the typed tool through normal permissions and the existing native action audit.
- Single native execution lease remains authoritative. Lock hints on the UI are **not** parallel execution guarantees.

## Not implemented or verified

- No complete autonomous multi-process worker dispatcher or independent AI models per worker yet. The native master still owns model calls, and one native tool executes at a time.
- The Blender bridge is **read-only** and launches a controlled background Blender worker, not a GUI/mouse-controlled scene. Blender mutations, saves, render outputs, task-to-task Blender session persistence and roundtrip asset import into Premiere are pending.
- A few Premiere/After Effects/Remotion tool families exist, but a complete cinematic editing workflow is not certified; actual application runtime acceptance needs an accessible Windows server and user-provided disposable sample projects.
- Internet asset lookup does not imply download rights or local availability.
- Work on this branch is **not** a Vercel deployment, production merge, signed installer, or AntCloud installation.

## Next controlled stages

1. Make Windows CI pass including Python bridge source checks and Rust native build.
2. Add a persistent, authorization-aware Blender session supervisor and typed mutation APIs that reuse the separate package's request/controller contracts, preserving object revision checks and readback.
3. Add evidence-bound artifact manifests and safe Premiere media import handoffs. Test on disposable projects, preserving backups.
4. Connect a durable worker-job scheduler to the mobile queue, with heartbeat, local project/resource locks, bounded retries only for known-safe reads, and explicit resume after uncertainty.
5. Add separate AI model allocation and bounded parallel planning, while serializing access to a shared desktop UI.

## Safety criteria

Never mark a graphics task or full edit complete based solely on an AI claim, a plan, a response path, a queued export, a claimed worker count, or an unaudited result. A failed/unknown Blender operation must be inspected rather than blindly replayed. This document describes source implementation, not live acceptance.
