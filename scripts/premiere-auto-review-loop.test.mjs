import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const lib = fs.readFileSync("src-tauri/src/lib.rs", "utf8");
const review = fs.readFileSync("src-tauri/src/premiere_review.rs", "utf8");
const docs = fs.readFileSync("docs/PREMIERE_AUTO_REVIEW.md", "utf8");

test("automatic review coordinator is registered end to end", () => {
  assert.match(lib, /premiere_review_session_continue/);
  assert.match(lib, /PremiereReviewSessionContinue \{ session_id: String \}/);
  assert.match(lib, /ToolAction::PremiereReviewSessionContinue/);
  assert.match(lib, /requires_target_selection/);
  assert.match(lib, /automatic_mutation/);
});

test("coordinator uses bounded prioritized grounded issues", () => {
  assert.match(review, /pub fn next_actionable_issue/);
  assert.match(review, /issue\.confidence >= 0\.65/);
  assert.match(review, /"high" => 2/);
  assert.match(review, /"caption"/);
  assert.match(review, /prioritizes_grounded_actionable_issue/);
});

test("automatic loop preserves explicit correction approval boundary", () => {
  assert.match(lib, /premiere_bind_review_fix/);
  assert.match(lib, /premiere_review_session_record_fix/);
  assert.match(lib, /requires_separate_approval/);
  assert.match(docs, /never chooses a correction value/);
  assert.match(docs, /production_ready=false/);
});


test("auto review phase 2 exposes bounded native correction candidates", () => {
  const binding = fs.readFileSync("src-tauri/src/premiere_review_binding.rs", "utf8");
  assert.match(binding, /inspection_candidates/);
  assert.match(binding, /candidate_count/);
  assert.match(binding, /static_edit_candidate/);
  assert.match(binding, /candidates\.len\(\)>=32/);
  assert.match(binding, /kind=="audio" && !value\.is_number\(\)/);
  assert.match(binding, /Vision evidence does not choose a native parameter or correction value/);
});


test("auto review phase 3 builds only separately approved exact correction proposals", () => {
  const binding = fs.readFileSync("src-tauri/src/premiere_review_binding.rs", "utf8");
  const rust = fs.readFileSync("src-tauri/src/lib.rs", "utf8");
  assert.match(binding, /pub fn static_correction_proposal/);
  assert.match(binding, /Desired correction value must match the inspected primitive native type/);
  assert.match(binding, /stale_target_guarded/);
  assert.match(rust, /premiere_plan_review_correction/);
  assert.match(rust, /PremierePlanReviewCorrection/);
  assert.match(rust, /COPY_EXECUTED_ACTION_ID/);
  assert.match(rust, /automatic_mutation/);
});


test("iterative auto review is integrated into professional edit jobs", () => {
  const job = fs.readFileSync("src-tauri/src/premiere_edit_job.rs", "utf8");
  const rust = fs.readFileSync("src-tauri/src/lib.rs", "utf8");
  assert.match(job, /pub iterative:bool/);
  assert.match(job, /premiere_review_session_start/);
  assert.match(job, /record_review/);
  assert.match(job, /Iterative review phase completes only from bounded completed review-session evidence/);
  assert.match(rust, /premiere_edit_job_record_review/);
  assert.match(rust, /Iterative review cannot be completed from the start-action receipt/);
  assert.match(rust, /last\.overall_confidence>=0\.65/);
});


test("40 percent milestone tracks issue-specific before and after correction evidence", () => {
  const review = fs.readFileSync("src-tauri/src/premiere_review.rs", "utf8");
  const rust = fs.readFileSync("src-tauri/src/lib.rs", "utf8");
  assert.match(review, /fn evaluate_attempt/);
  assert.match(review, /shared_sample/);
  assert.match(review, /"resolved"/);
  assert.match(review, /"regressed"/);
  assert.match(review, /after_issue_id/);
  assert.match(review, /before_confidence/);
  assert.match(rust, /latest_fix_evaluation/);
});
