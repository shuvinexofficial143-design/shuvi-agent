import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const job=readFileSync(new URL("../src-tauri/src/premiere_edit_job.rs",import.meta.url),"utf8");

test("AF edit jobs expose AA through AE optional phases",()=>{
  for(const field of [
    "media_prep","scene_detection","transcript_rebuild","track_organization",
    "layering","work_area","frame_delivery","interchange_export"
  ]) assert.match(job,new RegExp(field));
});

test("talking head rebuild strategy is explicit and exclusive",()=>{
  assert.match(job,/talking_head_strategy/);
  assert.match(job,/direct_cut/);
  assert.match(job,/source_rebuild/);
  assert.match(job,/must choose direct transcript cuts OR source rebuild/);
  assert.match(job,/Transcript rebuild requires explicit talking_head_strategy=source_rebuild/);
});

test("AF allows only one primary delivery",()=>{
  assert.match(job,/one primary delivery: media export, review frames, or interchange export/);
  assert.match(job,/self\.export\.is_some\(\) as usize/);
  assert.match(job,/self\.frame_delivery\.is_some\(\) as usize/);
  assert.match(job,/self\.interchange_export\.is_some\(\) as usize/);
});

test("AF maps phases only to existing typed tools",()=>{
  for(const tool of [
    "premiere_prepare_media_batch","premiere_detect_scene_cuts","premiere_detect_scene_markers",
    "premiere_apply_transcript_rebuild","premiere_organize_tracks","premiere_layer_clips",
    "premiere_set_work_area","premiere_export_review_frames","premiere_export_aaf",
    "premiere_export_otio","premiere_export_fcpxml"
  ]) assert.match(job,new RegExp(tool));
});

test("scene detection is replanned from fresh capability and timeline state",()=>{
  const next=rust.slice(rust.indexOf("ToolAction::PremiereEditJobNext {job_id}"));
  assert.match(next,/scene_detection_capabilities/);
  assert.match(next,/premiere_scene_detection::build_plan/);
  assert.match(next,/Scene-detection plan returned no expectation/);
});

test("transcript rebuild is replanned immediately before approval",()=>{
  const next=rust.slice(rust.indexOf("ToolAction::PremiereEditJobNext {job_id}"));
  assert.match(next,/"plan_transcript_rebuild"/);
  assert.match(next,/plan_snapshot/);
  assert.match(next,/"tool":phase\.tool/);
  assert.match(job,/premiere_apply_transcript_rebuild/);
});

test("layering rebinds current timeline and refuses stale source signatures",()=>{
  assert.match(rust,/expectation_for_layering\(&job,&timeline,&batch\)/);
  assert.match(job,/Layering source changed after an earlier edit-job phase/);
});

test("advanced edit-job phases remain separate approval proposals",()=>{
  assert.match(rust,/"requires_separate_approval":true/);
  assert.match(rust,/"no_hidden_mutation":true/);
  assert.match(rust,/"tool_proposal"/);
});

test("AF terminal delivery states distinguish export interchange and frames",()=>{
  assert.match(job,/export_dispatched/);
  assert.match(job,/interchange_delivered/);
  assert.match(job,/frames_delivered/);
});
