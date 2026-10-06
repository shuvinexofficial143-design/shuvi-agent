import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const lib=fs.readFileSync("src-tauri/src/lib.rs","utf8");
const characterAnimator=fs.readFileSync("src-tauri/src/character_animator.rs","utf8");
const status=fs.readFileSync("docs/CHARACTER_ANIMATOR_STATUS.md","utf8");

test("Character Animator 60 percent source tools are registered",()=>{
  for(const name of [
    "character_animator_capability_report",
    "character_animator_readiness_report",
    "character_animator_detect",
    "character_animator_launch",
    "character_animator_control_catalog",
    "character_animator_plan_control",
    "character_animator_runtime_preflight",
    "character_animator_plan_interchange"
  ]) assert.match(lib,new RegExp(name));
  for(const name of [
    "CharacterAnimatorControlCatalog",
    "CharacterAnimatorPlanControl",
    "CharacterAnimatorRuntimePreflight",
    "CharacterAnimatorPlanInterchange"
  ]) assert.match(lib,new RegExp(name));
});

test("Character Animator control catalog is planning only",()=>{
  assert.match(characterAnimator,/"source_milestone_percent":60/);
  assert.match(characterAnimator,/"execution_supported":false/);
  assert.match(characterAnimator,/record_take_work_area/);
  assert.match(characterAnimator,/export_png_wav/);
  assert.match(characterAnimator,/export_frame/);
  assert.match(characterAnimator,/project_trigger_key/);
  assert.match(characterAnimator,/midi_note/);
  assert.match(characterAnimator,/"runtime_input_adapter":"permission_first_preflight"/);
});

test("Character Animator trigger and MIDI plans require bounded project mapping acknowledgement",()=>{
  assert.match(characterAnimator,/acknowledge_project_mapping/);
  assert.match(characterAnimator,/trigger_key planning requires acknowledge_project_mapping=true/);
  assert.match(characterAnimator,/MIDI planning requires acknowledge_project_mapping=true/);
  assert.match(characterAnimator,/midi_note/);
  assert.match(characterAnimator,/0,127/);
});


test("Character Animator 60 percent runtime adapter is permission-first and focus-verified but input-free",()=>{
  assert.match(characterAnimator,/RuntimeControlPreflightRequest/);
  assert.match(characterAnimator,/explicit_user_approval/);
  assert.match(characterAnimator,/GetForegroundWindow/);
  assert.match(characterAnimator,/GetWindowThreadProcessId/);
  assert.match(characterAnimator,/managed_process_identity_verified/);
  assert.match(characterAnimator,/"input_delivery_implemented":false/);
  assert.match(lib,/managed_process_identity_matches\(state,request\.expected_pid\)/);
  assert.doesNotMatch(characterAnimator,/SendInput|SendKeys|keybd_event|midiOutShortMsg/);
});

test("Character Animator interchange planner is limited to documented handoff routes",()=>{
  assert.match(characterAnimator,/dynamic_link_after_effects/);
  assert.match(characterAnimator,/dynamic_link_premiere/);
  assert.match(characterAnimator,/media_encoder_export/);
  assert.match(characterAnimator,/\.chproj/);
  assert.match(characterAnimator,/"execution_supported":false/);
  assert.match(characterAnimator,/"mutation_performed":false/);
});

test("Character Animator 60 percent does not invent a host API or input sender",()=>{
  assert.match(characterAnimator,/"status":"no_public_host_api_claimed"/);
  assert.match(characterAnimator,/"host_transport":"not_implemented"/);
  assert.match(characterAnimator,/"future_host_transport":"no_public_host_api_claimed"/);
  assert.doesNotMatch(lib,/CharacterAnimatorSendKey/);
  assert.doesNotMatch(lib,/CharacterAnimatorSendMidi/);
  assert.doesNotMatch(lib,/CharacterAnimatorProjectContext/);
  assert.doesNotMatch(lib,/CharacterAnimatorExportExecute/);
});

test("Character Animator runtime and production flags remain false",()=>{
  assert.match(characterAnimator,/"source_runtime_verified":false/);
  assert.match(characterAnimator,/"production_ready":false/);
  assert.match(status,/Current declared source milestone: \*\*60%\*\*/);
  assert.match(status,/execution_supported=false/);
  assert.match(status,/source_runtime_verified=false/);
  assert.match(status,/production_ready=false/);
});
