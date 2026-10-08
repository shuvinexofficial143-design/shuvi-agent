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
