# Shuvi Web UI — Level 9: Advanced Creative Studio

Implementation branch: `ui-dashboard`, inside `web-dashboard/`.

## Delivered

A dedicated creative-software control **planning** interface replaces the former basic grid as the primary studio surface.

- 12 distinct software profiles: **Premiere Pro, After Effects, Adobe Animate, Audition, Media Encoder, Photoshop, Illustrator, Character Animator, Substance 3D, Frame.io, Blender, Remotion**.
- Searchable app selector, with source capabilities, overview, detailed capability inspection, and workflow-builder tabs.
- Per-application workflow templates and an editable task description with priority. **Save task draft** integrates with the existing browser Task planning board and activity timeline. It never launches an application.
- Per-application preflight guidance and connection states. Unknown installations and disconnected native bridges are not shown as ready.
- Blender is explicitly identified as a **separate repository**; actual Blender `bpy` readback and Windows bridge acceptance still require testing.
- Responsive 3-column desktop layout, small-screen one-column layout, keyboard-selectable tabs, persistent selected app, and the existing Midnight Sapphire / Arctic Violet / Teal Matrix / Steel Monochrome visual tokens.
- Original creative capability cards are preserved in a collapsible library, with all software category filters.
- Existing native-privileged routes, permission boundaries and desktop integration modules are unchanged.

## Limitations

**This is working browser UI and working browser task-draft creation, NOT a functioning live Adobe/Blender control bridge.** App installation, pairing and real command support cannot be confirmed from the disconnected browser. None of these cards should display verified runtime readiness without authenticated local evidence.

Source presence is distinct from practical native acceptance, and partial integrations such as Substance 3D are labeled accordingly. Some Adobe applications may require separate licensing.

For production execution, the desktop runtime still needs an authenticated browser-to-local command router, per-app health checks, a task manager with durable execution IDs, native permission approvals, redacted logs, and application-specific acceptance tests.

## How to review

In VS Code:

```powershell
cd C:\Users\shuvi\shuvi-agent
git pull --ff-only origin ui-dashboard
cd web-dashboard
npm test
npm run build
npm run dev -- --host 127.0.0.1 --port 1421 --strictPort
```

If 1421 is already occupied, **do not start a second server**; use its existing URL or stop the existing Vite process and restart with the desired port. Without `--strictPort`, Vite may silently switch to port 1422.

Open `http://127.0.0.1:1421/`, choose **Creative Studio**, select Blender or an Adobe app, choose **Workflow builder**, and save a browser task draft. Confirm it appears under Tasks and Level 8's timeline. Source capability cards remain under **Browse all creative capability cards**.

## Next milestone

Level 10: Master-Agent / worker-agent orchestration UI plus a native task-identity contract (first, source and validation), not an unverified fake parallel runtime.
