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
