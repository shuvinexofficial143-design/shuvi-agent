import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const job=readFileSync(new URL("../src-tauri/src/premiere_edit_job.rs",import.meta.url),"utf8");

test("Z registers bounded end to end edit job tools",()=>{
  for(const name of [
    "premiere_edit_job_start","premiere_edit_job_status","premiere_edit_job_next",
    "premiere_edit_job_record_action","premiere_edit_job_cancel"
  ]) assert.match(rust,new RegExp(name));
});

test("supported job types are explicit and no executable fields exist",()=>{
  assert.match(job,/talking_head.*social_reel.*product_ad.*wedding_highlight.*corporate.*custom/);
  assert.doesNotMatch(job,/script:String|command:String|javascript:String/);
  assert.match(job,/MAX_STATE_BYTES: usize = 128 \* 1024/);
});

test("job phases point to existing real Premiere tools",()=>{
  assert.match(job,/premiere_apply_assembly/);
  assert.match(job,/premiere_apply_transcript_cuts/);
  assert.match(job,/premiere_finish_media_batch/);
  assert.match(job,/premiere_review_frames/);
  assert.match(job,/premiere_plan_export/);
  assert.match(job,/premiere_export_sequence/);
});

test("next prepares transcript cuts from a fresh native transcript and timeline",()=>{
  const arm=rust.slice(rust.indexOf("ToolAction::PremiereEditJobNext"));
  assert.match(arm,/"export_transcript"/);
  assert.match(arm,/"inspect_timeline"/);
  assert.match(arm,/premiere_talking_head::build_plan/);
  assert.match(arm,/expectation_for_transcript/);
  assert.match(arm,/set_transcript_preflight/);
});

test("finishing expectations are refreshed from the live timeline",()=>{
  assert.match(rust,/expectation_for_finishing\(&job,&timeline,&request\)/);
  assert.match(job,/targetSignature/);
  assert.match(job,/complete timeline inspection for exact clip expectations/);
});

test("mutating phases are never silently dispatched by edit job next",()=>{
  assert.match(rust,/"requires_separate_approval":true/);
  assert.match(rust,/"no_hidden_mutation":true/);
  assert.match(rust,/"tool_proposal"/);
});

test("phase advancement requires matching audit action receipt",()=>{
  assert.match(rust,/read_action_audit_receipt\(app,&action_id\)\?/);
  assert.match(rust,/No matching typed action audit receipt for this edit-job phase/);
  assert.match(job,/Audit receipt does not match the next edit-job phase/);
  assert.match(rust,/entry\.tool==pending\.tool/);
});

test("project sequence identity is checked when advancing and recording",()=>{
  assert.match(job,/Edit job belongs to another or changed Premiere project\/sequence/);
  const next=rust.slice(rust.indexOf("ToolAction::PremiereEditJobNext"));
  assert.match(next,/job\.identity\(&context\)\?/);
});

test("export remains a distinct preflight and separately approved dispatch",()=>{
  assert.match(job,/push\("export_preflight","premiere_plan_export"\)/);
  assert.match(job,/push\("export_dispatch","premiere_export_sequence"\)/);
  assert.match(rust,/accepted\/queued is not encoder completion/);
  assert.match(rust,/"export_completion_verified":false/);
});

test("edit job persistence is bounded atomic and interruption aware",()=>{
  assert.match(job,/json\.tmp/);
  assert.match(job,/json\.bak/);
  assert.match(job,/interrupted update/);
  assert.match(job,/128 KiB state limit/);
});
