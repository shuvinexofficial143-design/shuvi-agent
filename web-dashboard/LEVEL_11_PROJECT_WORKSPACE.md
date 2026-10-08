# Shuvi Level 11 — Project Workspace

Repository: `shuvinexofficial143-design/shuvi-agent`
Branch: `ui-dashboard`
Frontend: `web-dashboard`

## Purpose and implementation

**Projects** is a dedicated web-only work organization page. It can organize planning drafts for a substantial project such as **Mahakal Lok 3D** without running the local Windows agent, launching Blender, or claiming access to the user's files.

Implemented features:
- Create, select, delete up to **12** project metadata records per browser origin.
- Project name (80 characters), description (300), last update timestamp and validation of stored records.
- Link/unlink existing browser task drafts. Original Tasks records are **not** moved, edited, deleted or executed by linking. Missing source task IDs are reported as missing, not converted into fake running jobs.
- Show worker delegation plans that refer to a project-linked task ID. Workers are planned only; duplicate saved plans are displayed as separate plans.
- Add or remove up to **40** asset references per project. An asset reference contains a user-entered name, type and optional reference string/filename, **not file bytes**. No file picker, network download, document scan or filesystem access is performed.
- Add/remove up to **40** project notes (550 characters each).
- Add/remove up to **24** workflow plans with a name, target application and planned steps. These are NOT executable recipes or queues.
- View up to **60** project-specific browser metadata history events. A browser event is NOT a verified native agent or Git audit receipt.
- Export **one project** as a JSON snapshot with its browser metadata only.
- Responsive layout uses the existing **Midnight Sapphire / Arctic Violet / Teal Matrix / Steel Monochrome** themes.
- Stored project selection survives browser reload where storage is available; if a project is removed, a valid remaining project is selected.

## Security and origin boundaries

Browser data uses the `shuvi.web.projects.v1` local storage key. This is **origin-scoped**: `http://localhost:1422` and `http://127.0.0.1:1423` do not share storage, and changing port or hostname produces a different origin. Consistently use one URL to keep your saved drafts and projects together.

No model/API invocation, file upload, approval, native task dispatch, desktop manipulation or local filesystem operation is implemented in the Projects page. The Vercel-hosted dashboard should not pretend that browser records mirror the Windows runtime.

Future desktop integration should use authenticated local pairing, per-project resource permissions, source file registry, native task identity, controlled asset preview, version/checkpoint receipts and proper ownership of application locks.

## How to run locally

```powershell
cd C:\Users\shuvi\shuvi-agent
git pull --ff-only origin ui-dashboard
cd web-dashboard
npm test
npm run build
npm run dev -- --host 127.0.0.1 --port 1423 --strictPort
```

Don't start a duplicate dev server if port 1423 is already served by the new Shuvi dashboard: reuse it or stop it and restart cleanly. A running old Desktop Vite UI at another port is not the new web app.

In the dashboard:
1. Open **Projects** in the left navigation.
2. Create `Mahakal Lok 3D`.
3. Open **Tasks & Agents** and check the existing `Mahakal Lok 3D Modeling` browser draft to link it to this project.
4. If a delegation to Blender Worker was planned earlier **on this same browser origin**, it appears automatically under the linked task.
5. Open **Assets & Notes** and add a reference label (e.g. `Cesium aerial view`). No actual image is imported.
6. Open **Workflows** and save a plan for the Blender corridor geometry. Open **Project History** to view real browser metadata updates.
7. Select **Export project JSON** to save a local copy of its metadata.

## Next

Level 12: Visual automation workflow builder and reusable task templates, still respecting native permission boundaries until the secure runtime is operational.
