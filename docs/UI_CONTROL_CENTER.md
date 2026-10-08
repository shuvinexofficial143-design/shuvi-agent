# Shuvi Control Center — UI Batch 1

This batch extends the existing Tauri/WebView2 desktop UI. It does **not** replace the Rust runtime, Adobe bridges, existing permission gate or Premiere panel.

## Implemented in this batch

- New main navigation: Dashboard, Chats, Agents & Apps, Approvals, Actions & Activity, Coding Workspace, Premiere Pro and AI Providers.
- Dashboard renders real local conversation status plus runtime memory, Premiere pairing and evidence-verified task-step counts when available.
- Chat history library: new, select, rename and delete conversations, stored locally with bounded visible assistant/user text.
- During an active task, pending permission, running action or unresolved crash-recovery checkpoint, switching chats is blocked to avoid cross-conversation execution.
- Agent catalog mirrors source modules rather than asserting real runtime support. Blender is explicitly identified as a separate repository requiring integration.
- Approvals screen directs the user to the existing action approval UI. No duplicate permission-execution path was introduced.
- Small responsive dark desktop UI style improvements. Existing controls and IDs are retained.

## Known limitations (not finished)

1. **Not concurrent execution:** only one active task may execute. True parallel chats require per-task provider state, Rust task IDs, scheduling, application/resource locks and audited checkpoints.
2. **History is a local UI convenience**, not a replacement for the bounded Rust active-task checkpoint. Only the last 45 visible user/assistant messages per chat, truncated to 3,000 characters each, persist. Internal tool result envelopes are not stored in this history.
3. A running/approval thread loaded after a restart is displayed as paused; runtime recovery remains the existing explicit Resume/Discard mechanism.
4. The Queued counter is fixed at zero and clearly marked unavailable until a real scheduler exists.
5. The only app with an existing dedicated desktop panel in this UI is Premiere. Other cards identify source implementations, not connected/verified runtimes. Blender is not integrated into the main Tauri registry yet.
6. UI metadata is stored in local WebView storage. Multi-chat production persistence needs native, identity-scoped storage, sensitive-data redaction and migration.
7. Vercel can eventually host a **web preview** of the frontend only; native Tauri invoke commands require a running Windows desktop bridge. Do not deploy a web preview as if it controls local Adobe/Blender.

## Next implementation batches

- **UI-2:** proper in-app rename/delete dialogs, searchable conversations, task detail inspector, native per-chat persistent session identities.
- **Runtime-1:** Rust task manager with individual durable task/agent states and execution queue. Shared Desktop/Telegram command routing.
- **Runtime-2:** safe parallel workers for independent resources; per-application locks for Windows UI and one Adobe project/timeline.
- **Integrations-1:** concrete health checks and application-specific control views for Photoshop, Illustrator, Audition, Animate, After Effects, media encoder and Blender.
- **Web preview:** a standalone read-only demo mode with explicit fake/demo indicators, separate from native Shuvi control.

## Validation

Run `npm test`, `npm run validate`, `npm run build` and `cargo check --manifest-path src-tauri/Cargo.toml` on the current branch. Then perform Windows WebView2 UI smoke checks and existing Premiere/permission regression tests. CI or source tests are not evidence of successful native Adobe/Blender runtime execution.


## UI batch 2 — October 8, 2026

- Chat sidebar now supports case-insensitive search. Rename/delete uses a native modal dialog with a second explicit delete confirmation, without the browser prompt.
- Dashboard includes actual active task-graph steps and evidence verification flags, not invented work progress. Completed labels require local typed-action evidence from the existing orchestrator.
- Adobe app cards for Photoshop, Illustrator, Audition and Animate now inspect their existing `*_bridge_status` commands without starting apps or changing settings. The catalog differentiates paired / waiting / stopped / status unavailable.
- Extended UI regression tests cover the new controls and require the web preview to remain isolated from native execution.
- A standalone static page at `preview/index.html` provides a clearly labeled design demonstration for a future Vercel preview deployment. All preview dashboard metrics are explicitly illustrative. The page does not run native actions or call external APIs.

### Vercel deployment boundary

The connected Vercel account exposes team `Avanti Verse` and other linked GitHub projects, but has no `shuvi-agent` preview project. Attempting to create `shuvi-ui-preview` via the linked Vercel API returned HTTP 403 (permission denied). No deployment or project has been created. Deploy only once authorized project-creation or a correct existing target is available; never overwrite the unrelated `shuvinex-frontend` project.
