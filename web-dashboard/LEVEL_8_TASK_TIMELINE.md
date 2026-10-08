# Shuvi UI — Level 8: Advanced Task Timeline

## Implemented (web dashboard)

The `ui-dashboard` branch's `web-dashboard` Tasks page now includes a fully interactive **browser-only planning timeline**.

- Timestamped, most-recent-first activity feed backed by the existing `shuvi.web.activity` records.
- Filter by Task, Module, Model, Routing, Settings and Export. Search the saved event text.
- Click a record to inspect its event type, origin and timestamp.
- Inspect saved task drafts with their title, priority, workspace and creation time.
- Summary counts of *real stored browser records* with visible limits: up to 80 activity entries and 20 task drafts.
- Export metadata to a local JSON file. Sensitive native credentials, receipts or screenshots are not queried.
- Live in-app refresh after task creation/removal, preference changes, and activity clearing, plus storage-event refresh across tabs.
- Responsive layout and button keyboard accessibility; styling is inherited from the user's selected Sapphire, Violet, Teal or Steel design palette.

## Explicit limitations

**This is not a real-time Windows agent execution timeline yet.** Browser activity records describe planning UI operations only. Tasks in the browser are drafts, not dispatch jobs. The Windows runtime isn't connected.

Therefore the interface shows em dashes or "Not synced" for actual Running / Approval / Completed states, agent steps, tool receipts and screenshots; it never fabricates them from draft counts.

The existing `Shuvi.exe` runtime and local per-action permission gate are not modified. A future native bridge must authenticate the local session and supply provenance-verified, task-ID-scoped events. Required follow-up features include independent task IDs, persistently recorded queued/running/approval/completed/error states, model and app worker identity, ordering, permission review links, redacted logs and access-controlled screenshot references.

## How to inspect

In the `web-dashboard` directory:

```powershell
npm test
npm run build
npm run dev -- --host 127.0.0.1 --port 1421 --strictPort
```

Open `http://127.0.0.1:1421`, choose **Tasks**, and create a browser draft. The feed will record the Task event. Try searching, filtering, selecting the event, inspecting the draft, and exporting the timeline. On reload the activity persists in the current browser (unless browser storage is unavailable).
