import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const lib=fs.readFileSync("src-tauri/src/lib.rs","utf8");
const characterAnimator=fs.readFileSync("src-tauri/src/character_animator.rs","utf8");
const status=fs.readFileSync("docs/CHARACTER_ANIMATOR_STATUS.md","utf8");

test("Character Animator 20 percent source tools are registered",()=>{
  for(const name of [
    "character_animator_capability_report",
    "character_animator_readiness_report",
    "character_animator_detect",
    "character_animator_launch"
  ]) assert.match(lib,new RegExp(name));
  for(const name of [
    "CharacterAnimatorCapabilityReport",
    "CharacterAnimatorReadinessReport",
    "CharacterAnimatorDetect",
    "CharacterAnimatorLaunch"
  ]) assert.match(lib,new RegExp(name));
});

test("Character Animator desktop detection is bounded and exact",()=>{
  assert.match(characterAnimator,/MAX_ADOBE_ENTRIES:usize=128/);
  assert.match(characterAnimator,/Adobe Character Animator/);
  assert.match(characterAnimator,/Support Files/);
  assert.match(characterAnimator,/Character Animator\.exe/);
  assert.match(characterAnimator,/exact_detected_executable/);
  assert.match(lib,/register_managed_process\(state,pid\)/);
});

test("Character Animator foundation does not invent an unsupported host transport",()=>{
  assert.match(characterAnimator,/"source_milestone_percent":20/);
  assert.match(characterAnimator,/"status":"research_required"/);
  assert.match(characterAnimator,/"implemented":false/);
  assert.match(characterAnimator,/"host_transport":"not_implemented"/);
  assert.match(characterAnimator,/"future_host_transport":"research_required"/);
  assert.match(status,/Current declared source milestone: \*\*20%\*\*/);
  assert.match(status,/future_host_transport=research_required/);
});

test("Character Animator 20 percent exposes no project mutation or runtime claim",()=>{
  assert.doesNotMatch(lib,/CharacterAnimatorSet/);
  assert.doesNotMatch(lib,/CharacterAnimatorExport/);
  assert.doesNotMatch(lib,/CharacterAnimatorRecord/);
  assert.match(characterAnimator,/"source_runtime_verified":false/);
  assert.match(characterAnimator,/"production_ready":false/);
  assert.match(status,/source_runtime_verified=false/);
  assert.match(status,/production_ready=false/);
});
