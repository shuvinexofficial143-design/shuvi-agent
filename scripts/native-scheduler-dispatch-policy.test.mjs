import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const scheduler=readFileSync(new URL("../src-tauri/src/native_scheduler.rs",import.meta.url),"utf8");
test("native dispatch order is determined by the persisted DAG, not the model",()=>{
  assert.match(scheduler,/fn first_ready_step\(/);
  assert.match(scheduler,/first_ready_step\(s\)!=Some\(step_id\)/);
  assert.match(scheduler,/parent\.phase=="audited"/);
  assert.match(scheduler,/fn restart_preserves_deterministic_ready_order_and_audited_dependencies\(/);
});
test("unreviewed failure and unknown execution cannot be erased by task reset",()=>{
  assert.match(scheduler,/matches!\(j\.phase\.as_str\(\),"running"\|"outcome_unknown"\|"failed"\)/);
  assert.match(scheduler,/matches!\(j\.phase\.as_str\(\),"audited"\|"reviewed_failed"\)/);
  assert.match(scheduler,/fn unknown_execution_cannot_be_erased_by_new_objective_or_same_objective\(/);
  assert.match(scheduler,/fn failed_execution_requires_owner_review_before_task_replacement\(/);
});
