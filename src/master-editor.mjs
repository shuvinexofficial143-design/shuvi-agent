// Master Editor Phase 1: route an ordinary user creative brief through the
// EXISTING typed and permission-gated Windows executor. This is guidance for the
// native model, not a fake worker process or evidence of host execution.
export const EDITOR_WORKERS = Object.freeze({
  premiere: Object.freeze({
    available: true,
    inspection: "premiere_context",
    execution: "premiere_insert_media",
    role: "timeline, media assembly, editorial finishing and export"
  }),
  after_effects: Object.freeze({
    available: true,
    inspection: "after_effects_run",
    execution: "after_effects_run",
    role: "compositing and motion graphics with exact host/project guards"
  }),
  remotion: Object.freeze({
    available: true,
    inspection: "motion_graphics_plan_remotion",
    execution: "motion_graphics_run_remotion",
    role: "bounded programmatic 2D graphics and verified media renders"
  }),
  browser: Object.freeze({
    available: true,
    inspection: "browser_start",
    execution: null,
    role: "research potential licensed assets, not an asserted download"
  }),
  blender: Object.freeze({
    available: false,
    inspection: null,
    execution: null,
    role: "separate Blender-agent repository; no native worker dispatch in this app"
  })
});
const EDITING_INTENT = /(?:premiere|premire|प्रिमियर|एडिट|editing|editor|\bedit\b|blender|ब्लेंडर|after\s*effects|आफ्टर\s*इफेक्ट|remotion|motion\s*graphic|मोशन\s*ग्राफिक|cinematic|सिनेमैटिक|\bvfx\b|video|वीडियो|reel|रील)/i;
const CONTEXT_LIMIT = 3000;
const MASTER_GUIDANCE = [
  "MASTER EDITOR ROUTER (native execution only; this is NOT completed work):",
  "- You choose the specialist/app and exact next approved tool from the user goal. The user must not have to specify mouse clicks, workers, or intermediate editing steps.",
  "- Start with actual project, timeline, screen and asset inspection. Ground all creative decisions in observed material; do not invent files, shots, rights, host capabilities or output.",
  "- Premiere: use premiere_context/premiere_timeline and current bridge evidence; use typed native editing and final export with fresh project/sequence/clip guards.",
  "- Motion asset needed? Route to existing after_effects_run with exact project/revision OR motion_graphics_generate_plan -> motion_graphics_run_remotion. A planner response is NOT a rendered asset.",
  "- For Remotion-to-Premiere handoff, require reviewed render, motion_graphics_accept_final_remotion and motion_graphics_plan_premiere_insertion before the approved premiere_insert_media step. Never infer a verified render from a path.",
  "- Blender currently has no callable native worker in this repository. If a task specifically needs Blender, mark that worker unavailable; do not claim to have delegated or rendered 3D.",
  "- Browser can research asset sources; download/permission, local path and usage rights need independent confirmation before Premiere import.",
  "- Use the existing task_graph with dependency-bound typed action receipts when useful, never model-supplied completion. Shared Windows UI actions are sequential; all mutations keep normal approval, audit and checkpoints.",
  "- A single run has an eight-action safety budget. If more work is needed, preserve progress and report unfinished stages; never mark the whole edit done because one action succeeded."
].join("\n");
export function editingMasterContext(messages) {
  if (!Array.isArray(messages)) return "";
  const lastUser = [...messages].reverse().find(m => m && m.role === "user");
  return typeof lastUser?.content === "string" && EDITING_INTENT.test(lastUser.content.slice(0, 16384))
    ? MASTER_GUIDANCE : "";
}
export function orchestrationWithMasterEditor(base, messages) {
  const stableBase = typeof base === "string" ? base.slice(0, CONTEXT_LIMIT) : "";
  const editor = editingMasterContext(messages);
  if (!editor) return stableBase;
  const available = CONTEXT_LIMIT - editor.length - 1;
  // Dynamic orchestration receipts are never dropped entirely in favor of
  // advisory routing text. The backend applies the same 3000-byte/char gate.
  return stableBase.slice(0, Math.max(0, available)) + "\n" + editor;
}
