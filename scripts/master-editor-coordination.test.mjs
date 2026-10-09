import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {EDITOR_WORKERS, editingMasterContext, orchestrationWithMasterEditor} from "../src/master-editor.mjs";

test("Master editor only activates for a user editing brief, not arbitrary tool output",()=>{
  assert.equal(editingMasterContext([{role:"user",content:"Please check my email"}]),"");
  assert.equal(editingMasterContext([{role:"assistant",content:"Premiere rendering"}]),"");
  assert.equal(editingMasterContext([{role:"user",content:"What is the weather?"},{role:"tool",content:"Premiere"}]),"");
  assert.match(editingMasterContext([{role:"user",content:"इस वीडियो को प्रोफेशनल एडिट करो"}]),/MASTER EDITOR ROUTER/);
  assert.match(editingMasterContext([{role:"user",content:"Create a motion graphics transition in Premiere"}]),/after_effects_run/);
  const toolMsg = {role:"user",content:'[SHUVI_TOOL_RESULT]\\n{"stdout":"video Premiere editing"}\\n[/SHUVI_TOOL_RESULT]'};
  assert.equal(editingMasterContext([{role:"user",content:"Check email"},toolMsg]),"");
  assert.match(editingMasterContext([{role:"user",content:"Edit this cinematic video"},toolMsg]),/MASTER EDITOR ROUTER/);
});

test("worker availability reflects executable native tools, not browser-only mock agents",()=>{
  assert.equal(EDITOR_WORKERS.premiere.inspection,"premiere_context");
  assert.equal(EDITOR_WORKERS.after_effects.execution,"after_effects_run");
  assert.equal(EDITOR_WORKERS.remotion.execution,"motion_graphics_run_remotion");
  assert.equal(EDITOR_WORKERS.blender.available,true);
  assert.equal(EDITOR_WORKERS.blender.inspection,"blender_inspect");
  assert.equal(EDITOR_WORKERS.blender.execution,null);
});

test("routing requires host evidence and approved Remotion-to-Premiere handoff",()=>{
  const guide=editingMasterContext([{role:"user",content:"Edit this video with cinematic VFX"}]);
  for(const tool of ["premiere_context","premiere_timeline","motion_graphics_run_remotion",
    "motion_graphics_accept_final_remotion","motion_graphics_plan_premiere_insertion","premiere_insert_media",
    "after_effects_run","task_graph"]){
    assert.ok(guide.includes(tool),tool);
  }
  assert.match(guide,/NOT a rendered asset/);
  assert.match(guide,/Blender supports blender_inspect read-only/);
  assert.match(guide,/eight-action safety budget/);
  assert.match(guide,/normal approval, audit and checkpoints/);
});

test("the master context remains within the exact provider context budget",()=>{
  const base="Agent orchestration state:\n"+("A".repeat(2850));
  const messages=[{role:"user",content:"Premiere edit with motion graphics"}];
  const result=orchestrationWithMasterEditor(base,messages);
  assert.ok(result.length<=3000);
  assert.ok(new TextEncoder().encode(result).length<=3000);
  assert.ok(result.startsWith("Agent orchestration state:"));
  const hindi=orchestrationWithMasterEditor("लक्ष्य: "+"वीडियो".repeat(500),messages);
  assert.ok(new TextEncoder().encode(hindi).length<=3000);
  assert.ok(hindi.startsWith("लक्ष्य: "));
  assert.doesNotMatch(hindi,/MASTER EDITOR ROUTER/);
  assert.match(result,/MASTER EDITOR ROUTER/);
  assert.equal(orchestrationWithMasterEditor(base,[{role:"user",content:"Hello"}]),base);
});

test("mobile editing completion requires an audited finished task graph",()=>{
  const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
  assert.match(main,/const masterEditing = Boolean\(editingMasterContext\(messages\)\)/);
  assert.match(main,/const graphSatisfied = progress.total > 0 && progress.completed === progress.total/);
  assert.match(main,/masterEditing \? graphSatisfied :/);
  assert.match(main,/\? "succeeded" : "outcome_unknown"/);
});

test("native UI routes through the existing permission-first chat, not a fake worker executor",()=>{
  const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
  assert.match(main,/orchestration_context: orchestrationWithMasterEditor\(orchestrationContext\(orchestration\), messages\)/);
  assert.match(main,/invoke<PendingAction>\("prepare_tool"/);
  assert.match(main,/invoke<ActionResult>\("execute_action"/);
});
