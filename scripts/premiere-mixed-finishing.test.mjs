import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const moduleSource=readFileSync(new URL("../src-tauri/src/premiere_finishing.rs",import.meta.url),"utf8");

test("X2 registers real mixed finishing and cooperative cancellation",()=>{
  assert.match(rust,/- premiere_finish_media_batch:/);
  assert.match(rust,/- premiere_finish_media_batch_cancel:/);
  assert.match(rust,/"premiere_finish_media_batch" =>/);
  assert.match(rust,/ToolAction::PremiereFinishMediaBatch/);
  assert.match(rust,/ToolAction::PremiereBatchFinishCancel/);
});

test("mixed finishing is explicitly bounded",()=>{
  assert.match(moduleSource,/MAX_VIDEO: usize = 32/);
  assert.match(moduleSource,/MAX_AUDIO: usize = 32/);
  assert.match(moduleSource,/MAX_TOTAL_TARGETS: usize = 48/);
  assert.match(moduleSource,/at most 48 existing clip targets/);
});

test("video and audio targets are independently inspected",()=>{
  assert.match(rust,/plan_video_recipe/);
  assert.match(rust,/plan_audio_automation/);
  assert.match(rust,/apply_video_recipe/);
  assert.match(rust,/apply_audio_recipe/);
  assert.match(rust,/Mixed finishing video target is missing its exact expectation/);
  assert.match(rust,/Mixed finishing audio target is missing its exact expectation/);
});

test("mapped graphics reuse V2 instead of duplicate insertion logic",()=>{
  assert.match(rust,/premiere_graphics::run_batch/);
  assert.match(rust,/insert_mapped_graphic/);
  assert.match(rust,/Unknown mixed finishing graphics mapping/);
});

test("one durable checkpoint precedes mixed mutation",()=>{
  const arm=rust.slice(rust.indexOf("ToolAction::PremiereFinishMediaBatch"));
  assert.match(arm,/backup_premiere_project\(&premiere_bridge\)\.await\?/);
  assert.match(arm,/checkpoint_path = checkpoint\.clone/);
});

test("representative review samples are affected clip midpoints and bounded",()=>{
  assert.match(moduleSource,/MAX_REVIEW_SAMPLES: usize = 8/);
  assert.match(moduleSource,/let midpoint = start \+ \(end - start\) \/ 2\.0/);
  assert.match(rust,/"before":before_review/);
  assert.match(rust,/"after":after_review/);
  assert.match(rust,/subjective_quality_guaranteed/);
});

test("uncertain delivery stops later finishing work",()=>{
  assert.match(rust,/if uncertain \{ break; \}/);
  assert.match(rust,/if !uncertain/);
  assert.match(rust,/"uncertain":uncertain/);
});

test("unsupported professional features stay explicit",()=>{
  assert.match(rust,/"speed_ramp","masks","multicam","inferred_linked_media"/);
});

test("mixed finishing stops video or audio work when recipe readback is unverified",()=>{
  const arm=rust.slice(rust.indexOf("ToolAction::PremiereFinishMediaBatch"),rust.indexOf("ToolAction::PremiereFinishMediaBatchCancel"));
  assert.match(arm,/verified_recipe/);
  assert.match(arm,/post_state_verified/);
  assert.match(arm,/if !verified \{ uncertain=true; break; \}/);
  assert.match(arm,/"status":if verified\{"applied"\}else\{"uncertain"\}/);
});
