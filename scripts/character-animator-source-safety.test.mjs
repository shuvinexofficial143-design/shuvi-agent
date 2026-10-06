import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const lib=fs.readFileSync("src-tauri/src/lib.rs","utf8");
const characterAnimator=fs.readFileSync("src-tauri/src/character_animator.rs","utf8");
const status=fs.readFileSync("docs/CHARACTER_ANIMATOR_STATUS.md","utf8");

test("Character Animator 100 percent source tools are registered",()=>{
  for(const name of [
    "character_animator_capability_report",
    "character_animator_readiness_report",
    "character_animator_detect",
    "character_animator_launch",
    "character_animator_control_catalog",
    "character_animator_plan_control",
    "character_animator_runtime_preflight",
    "character_animator_execute_application_shortcut",
    "character_animator_plan_interchange",
    "character_animator_acceptance_summary"
  ]) assert.match(lib,new RegExp(name));
  for(const name of [
    "CharacterAnimatorControlCatalog",
    "CharacterAnimatorPlanControl",
    "CharacterAnimatorRuntimePreflight",
    "CharacterAnimatorExecuteApplicationShortcut",
    "CharacterAnimatorPlanInterchange",
    "CharacterAnimatorAcceptanceSummary"
  ]) assert.match(lib,new RegExp(name));
});

test("Character Animator final control catalog stays bounded to fixed shortcut execution plus planning-only trigger MIDI surfaces",()=>{
  assert.match(characterAnimator,/"source_milestone_percent":100/);
  assert.match(characterAnimator,/"source_scope_complete":true/);
  assert.match(characterAnimator,/"execution_supported":false/);
  assert.match(characterAnimator,/record_take_work_area/);
  assert.match(characterAnimator,/export_png_wav/);
  assert.match(characterAnimator,/export_frame/);
  assert.match(characterAnimator,/project_trigger_key/);
  assert.match(characterAnimator,/midi_note/);
  assert.match(characterAnimator,/"runtime_input_adapter":"bounded_application_shortcuts"/);
});

test("Character Animator trigger and MIDI plans require bounded project mapping acknowledgement",()=>{
  assert.match(characterAnimator,/acknowledge_project_mapping/);
  assert.match(characterAnimator,/trigger_key planning requires acknowledge_project_mapping=true/);
  assert.match(characterAnimator,/MIDI planning requires acknowledge_project_mapping=true/);
  assert.match(characterAnimator,/midi_note/);
  assert.match(characterAnimator,/0,127/);
});


test("Character Animator 100 percent bounded shortcut delivery remains permission-first, fixed and focus-rechecked",()=>{
  assert.match(characterAnimator,/RuntimeControlPreflightRequest/);
  assert.match(characterAnimator,/explicit_user_approval/);
  assert.match(characterAnimator,/GetForegroundWindow/);
  assert.match(characterAnimator,/GetWindowThreadProcessId/);
  assert.match(characterAnimator,/application_shortcut_send_keys/);
  assert.match(characterAnimator,/SendKeys\]::SendWait/);
  assert.match(characterAnimator,/foreground_rechecked_immediately_before_send/);
  assert.match(characterAnimator,/project_trigger_execution":false/);
  assert.match(characterAnimator,/midi_execution":false/);
  assert.match(lib,/managed_process_identity_matches\(state,request\.expected_pid\)/);
  assert.match(lib,/CharacterAnimatorExecuteApplicationShortcut/);
  assert.match(lib,/RiskLevel::High/);
  assert.doesNotMatch(characterAnimator,/midiOutShortMsg|CharacterAnimatorSendMidi/);
});

test("Character Animator interchange planner is limited to documented handoff routes",()=>{
  assert.match(characterAnimator,/dynamic_link_after_effects/);
  assert.match(characterAnimator,/dynamic_link_premiere/);
  assert.match(characterAnimator,/media_encoder_export/);
  assert.match(characterAnimator,/\.chproj/);
  assert.match(characterAnimator,/"execution_supported":false/);
  assert.match(characterAnimator,/"mutation_performed":false/);
});

test("Character Animator 100 percent source completion does not invent a host API or MIDI sender",()=>{
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
  assert.match(status,/Current declared source milestone: \*\*100%\*\*/);
  assert.match(characterAnimator,/canonical_source_acceptance_summary/);
  assert.match(characterAnimator,/intentionally_unclaimed/);
  assert.match(lib,/character_animator_acceptance_summary/);
  assert.match(status,/source_runtime_verified=false/);
  assert.match(status,/production_ready=false/);
});
