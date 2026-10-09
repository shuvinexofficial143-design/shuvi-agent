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
    available: true,
    inspection: "blender_inspect",
    execution: null,
    role: "read-only Python controller bridge; mutation/rendering not connected"
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
  "- Blender supports blender_inspect read-only through an explicitly approved Python background bridge. Actual 3D edits, saves and renders have no connected native worker yet; do not claim their execution.",
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
// Rust bounds orchestration_context in UTF-8 bytes, not JS UTF-16 length.
// Stop on a complete code point so Hindi prompts cannot exceed that limit.
function utf8Prefix(value, byteLimit) {
  const encoder = new TextEncoder();
  let result = "", used = 0;
  for (const char of value) {
    const bytes = encoder.encode(char).length;
    if (used + bytes > byteLimit) break;
    result += char;
    used += bytes;
  }
  return result;
}
// Rust's TOOL_PROTOCOL already contains the complete Master Editor rules.
// Preserve existing graph/audit/failure state. Only add a tiny hint when there
// is room; never truncate important progress to repeat a static instruction.
const MASTER_SHORT_HINT = "MASTER EDITOR ROUTER: choose approved native specialists; do not report completion without audited evidence.";
export function orchestrationWithMasterEditor(base, messages) {
  const stableBase = utf8Prefix(typeof base === "string" ? base : "", CONTEXT_LIMIT);
  if (!editingMasterContext(messages)) return stableBase;
  const withHint = stableBase + "\n" + MASTER_SHORT_HINT;
  return new TextEncoder().encode(withHint).length <= CONTEXT_LIMIT ? withHint : stableBase;
}
