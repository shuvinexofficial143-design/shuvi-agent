import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const job=readFileSync("src-tauri/src/premiere_edit_job.rs","utf8");
const host=readFileSync("src-tauri/src/lib.rs","utf8");
const caption=readFileSync("src-tauri/src/premiere_caption_graphics.rs","utf8");
const graphic=readFileSync("src-tauri/src/premiere_graphics.rs","utf8");
function route(start,end) {
  const a=host.indexOf(start),b=host.indexOf(end,a);
  assert.ok(a>=0&&b>a,"Missing exact edit job route: "+start);
  return host.slice(a,b);
}
test("professional edit-job accepts selected caption graphics as optional legacy-compatible phase",()=>{
  assert.match(job,/use crate::premiere_caption_graphics::Request as CaptionGraphicsRequest/);
  assert.match(job,/#\[serde\(default\)\] pub caption_graphics:Option<CaptionGraphicsRequest>/);
  assert.match(job,/self\.caption_graphics\.is_none\(\)/);
  assert.match(job,/if let Some\(value\)=&self\.caption_graphics\{value\.validate\(\)\?;\}/);
  assert.match(job,/caption_graphics:None,work_area:None/);
});
test("caption pipeline phases are source plan then owner-approved apply then explicit save before review/export",()=>{
  const plan=job.indexOf('push("caption_graphics_plan","premiere_plan_caption_graphics")');
  const apply=job.indexOf('push("caption_graphics_apply","premiere_apply_caption_graphics")');
  const save=job.indexOf('push("caption_project_save","premiere_save_project")');
  const review=job.indexOf('push("review",if review.iterative');
  const exportPos=job.indexOf('push("export_preflight","premiere_plan_export")');
  assert.ok(plan>=0&&plan<apply&&apply<save&&save<review&&review<exportPos);
  assert.match(job,/fn selective_caption_graphics_join_audited_job_before_review_and_export/);
  assert.match(job,/assert!\(job\.record\("caption_graphics_apply"/);
  assert.match(job,/fn caption_request_rejects_missing_source_selection_without_any_job/);
});
test("edit-job next validates actual SRT SHA/template revision then checks native track occupancy before high risk proposal",()=>{
  const stage=route('ToolAction::PremiereEditJobNext {job_id} => {',
    'ToolAction::PremiereEditJobRecordAction {');
  const begin=stage.indexOf('"caption_graphics_plan" | "caption_graphics_apply" => {');
  const end=stage.indexOf('"caption_project_save" => {',begin);
  assert.ok(begin>=0&&end>begin);
  const block=stage.slice(begin,end);
  assert.match(block,/job\.request\.caption_graphics\.clone\(\)/);
  assert.match(block,/premiere_graphics::list\(&graphics_library_path\(app\)\?\)/);
  assert.match(block,/premiere_caption_graphics::plan\(&request,saved\)/);
  assert.match(block,/premiere_bridge\.request\(/);
  assert.match(block,/"inspect_timeline"/);
  assert.match(block,/premiere_caption_graphics::preflight_timeline\(/);
  assert.match(block,/"request":request,"expected":job\.project_expectation\(\)/);
  assert.doesNotMatch(block,/insert_mapped_graphic|backup_premiere_project|request\("save_project"/);
  assert.match(caption,/pub fn preflight_timeline/);
  assert.match(graphic,/pub async fn run_batch/);
});
test("edit-job save phase remains separate approval, and existing export dispatch never implies encoding completion",()=>{
  const stage=route('ToolAction::PremiereEditJobNext {job_id} => {',
    'ToolAction::PremiereEditJobRecordAction {');
  const save=stage.slice(stage.indexOf('"caption_project_save" => {'),
    stage.indexOf('"review" => {',stage.indexOf('"caption_project_save" => {')));
  assert.match(save,/json!\(\{\}\)/);
  assert.doesNotMatch(save,/\.request\("save_project"|backup_premiere_project/);
  assert.match(stage,/requires_separate_approval":true/);
  assert.match(stage,/accepted\/queued is not encoder completion/i);
  assert.match(job,/pub fn record\(/);
});

test("each Edit Job phase persists its first proposal and rejects stale or reused typed action receipts",()=>{
  assert.match(job,/proposal_issued_at_ms:Option<u64>/);
  assert.match(job,/pub fn issue_proposal\(/);
  assert.match(job,/pub fn require_issued_action_receipt\(/);
  assert.match(job,/receipt_timestamp_ms<issued/);
  assert.match(job,/p\.action_id\.as_deref\(\)==Some\(action_id\)/);
  assert.match(job,/fn edit_job_phase_proposal_and_receipt_are_temporally_bound/);
  assert.match(job,/fn legacy_edit_job_phase_is_compatible_but_requires_new_proposal/);
  const next=route('ToolAction::PremiereEditJobNext {job_id} => {',
    'ToolAction::PremiereEditJobRecordAction {');
  assert.match(next,/job\.issue_proposal\(&phase\.id,now_ms\(\)\)\?;/);
  assert.match(next,/premiere_edit_job::save\(&path,&job\)\?;/);
  const record=route('ToolAction::PremiereEditJobRecordAction {job_id,phase_id,action_id} => {',
    'ToolAction::PremierePlanReviewCorrection {');
  assert.match(record,/job\.require_issued_action_receipt\(&phase_id,&action_id,receipt\.timestamp_ms\)\?;/);
  assert.match(record,/entry\.timestamp_ms>=job\.created_at_ms/);
  assert.match(record,/entry\.tool==pending\.tool/);
});

test("saved professional Edit Job revalidates canonical phase and receipt state before disk load/save",()=>{
  assert.match(job,/pub fn validate_state\(&self\)->Result<\(\),String>/);
  assert.match(job,/let fresh=Self::new\(self\.job_id\.clone\(\),self\.request\.clone\(\)/);
  assert.match(job,/phase\.id!=canonical\.id \|\| phase\.tool!=canonical\.tool/);
  assert.match(job,/Edit-job has an approved phase after an incomplete phase/);
  assert.match(job,/Edit-job action receipt is duplicated or placed on an unexecuted phase/);
  assert.match(job,/job\.validate_state\(\)\?;/);
  assert.match(job,/fn persisted_edit_job_ledger_rejects_fabricated_progress/);
  assert.match(job,/fn persisted_edit_job_fail_and_cancel_have_single_consistent_frontier/);
});
