import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const report=readFileSync(new URL("../src-tauri/src/premiere_acceptance.rs",import.meta.url),"utf8");
const execution=readFileSync(new URL("../src-tauri/src/premiere_acceptance_execution.rs",import.meta.url),"utf8");

test("move and clone promote only after verified acceptance poststate",()=>{
  assert.match(rust,/matches!\(record\.step\.as_str\(\),"trim"\|"move"\|"clone"\|"delete_ripple"\|"scene_markers"\)/);
  assert.match(rust,/verified_timeline_edit\("move_clone","premiere_move_clip"/);
  assert.match(rust,/verified_timeline_edit\("move_clone","premiere_clone_clip"/);
  assert.match(rust,/"move_clone":verified\("move_clone"\)/);
  assert.match(report,/\("move_clone","premiere_move_clip"\)/);
  assert.match(report,/\("move_clone","premiere_clone_clip"\)/);
  assert.match(execution,/"move" => fixture\.delta_seconds/);
  assert.match(execution,/"clone" => fixture\.delta_seconds/);
  assert.match(execution,/move_and_clone_require_exact_observed_poststate/);
});

test("move clone acceptance still requires checkpoint and no blind retry",()=>{
  assert.match(report,/checkpoint\.is_empty\(\)/);
  assert.match(rust,/"retry_automatically":false/);
  assert.match(rust,/"cleanup_needed":matches!\(record\.step\.as_str\(\),"clone"\|"delete_ripple"\|"scene_markers"\)/);
});
