# Shuvi Level 12 — Visual Workflow Builder

Repository: `shuvinexofficial143-design/shuvi-agent`
Branch: `ui-dashboard`
Frontend: `web-dashboard`
Status: functional **browser-only planning UI**, not native automation execution.

## Implemented

- New **Workflows** navigation route and full-page three-column workflow studio.
- 5 starter templates: **Blender Scene**, **Premiere Editing**, **After Effects Graphics**, **Coding & Verification**, and **Blank**.
- Visual connected step sequence with nodes marked **DRAFT**. Click to select and inspect any step; edit step kind, title and instructions, add steps, change order with up/down, and remove steps. The final END node means the plan is saved, not executed.
- Step types: Start, Action, Review, Approval, Export. Approval steps are **plans only** and never grant OS/native permissions.
- Browser-persisted workflow collection with validation, limits of 24 plans and 12 steps per plan, deduplicated IDs, bounded metadata fields, and safe text rendering using `textContent` (no HTML interpolation).
- Workflow title and linked project association, with project choices taken from the existing `shuvi.web.projects.v1` store.
- Project Workspace → Workflows now lists associated **visual plans** alongside older simple project workflow notes. Clicking a visual plan opens that plan in the builder.
- **Save as task draft** creates a separate existing browser Task draft; it does not dispatch execution.
- JSON export is a metadata snapshot containing planned nodes, not files, tool receipts, credentials or native actions.
- Updates stored under `shuvi.web.visual-flows.v1`. Source activity is logged to existing browser planning history. Changes to a flow refresh the Project Workspace.
- Midnight Sapphire/Arctic Violet/Teal/Steel styling, responsive layouts, keyboard-accessible buttons and input labels.

## Hard safety boundary

The current web UI **does not**:
- run Blender, Premiere, Adobe or shell commands;
- call LLM providers or desktop APIs;
- request or bypass native permissions;
- connect a parallel worker queue;
- claim nodes completed, running or approved;
- open/read local file bytes or upload assets.

It remains offline browser planning until a separately authenticated, permission-gated Shuvi Windows runtime is connected. The browser Graph is ordered linear planning, not an arbitrary DAG scheduler; real parallel branches/dependencies need a future native contract.

## Testing locally

From the local `ui-dashboard` checkout:

```powershell
cd C:\Users\shuvi\shuvi-agent
git pull --ff-only origin ui-dashboard
npm run dev
```

Keep the terminal running and open the fixed **http://127.0.0.1:1423/** URL. If the port is occupied by an older Vite server, stop the **old server** first; `strictPort` prevents automatic port hopping.

Suggested test:
1. Open **Projects**, select your saved `Mahakal Lok 3D` project, and click **Workflows → Open Visual Builder**.
2. In the builder choose **Blender Scene Pipeline**. Under workflow settings, choose `Mahakal Lok 3D` and save.
3. Click any visual node, edit its title and details, press **Save step changes**. Try **+ Add Step**, **Move Up/Down**, and return to the saved workflow list.
4. Back in **Projects → Workflows**, confirm the linked visual workflow appears, then click its row to return to that precise workflow.
5. Use **Save as task draft** and verify a planning draft appears in Tasks. Export JSON if desired.
6. Verify nothing in the Windows runtime starts; runtime remains Not Connected.

## Next

Level 13 proposal: authenticated Windows runtime handshake, trustworthy execution identity and dashboard/native event transport design. This is a separate engineering and host-testing milestone, not another fictitious web mockup.
