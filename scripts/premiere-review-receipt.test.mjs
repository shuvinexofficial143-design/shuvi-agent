import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const review=readFileSync(new URL("../src-tauri/src/premiere_review.rs",import.meta.url),"utf8");

test("Premiere review sessions persist creation time in schema v2",()=>{
  assert.match(review,/pub schema_version: u8,[\s\S]*pub created_at_ms: u64/);
  assert.match(review,/schema_version: 2, created_at_ms/);
  assert.match(review,/session\.schema_version != 2 \|\| session\.created_at_ms == 0/);
  assert.match(review,/created_at_ms == 0/);
});

test("approved review fixes cannot reuse pre-session audit receipts",()=>{
  const start=lib.indexOf("ToolAction::PremiereReviewSessionRecordFix");
  const end=lib.indexOf("ToolAction::PremiereReviewSessionNext",start);
  const block=lib.slice(start,end);
  assert.match(block,/read_action_audit_receipt\(app,&approved_action_id\)/);
  assert.match(block,/entry\.timestamp_ms >= session\.created_at_ms/);
  assert.match(block,/from this review session/);
});

test("review session constructors bind current local timestamp",()=>{
  assert.match(lib,/max_iterations,now_ms\(\)\.max\(1\)\)\?/);
  const occurrences=[...lib.matchAll(/premiere_review::Session::new\(/g)].length;
  assert.equal(occurrences,2);
});
