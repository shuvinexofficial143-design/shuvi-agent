import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const desktop=readFileSync("src-tauri/src/lib.rs","utf8");
const session=readFileSync("src-tauri/src/premiere_edit_session.rs","utf8");

test("versioned edit session routes require audit or real review before completion",()=>{
  for(const tool of ["start","status","next","record_action","record_review","cancel"]){
    assert.ok(desktop.includes(`"premiere_edit_session_${tool}"`));
  }
  assert.match(desktop,/e\.timestamp_ms>=session\.created_at_ms/);
  assert.match(desktop,/e\.event=="executed"/);
  assert.match(desktop,/review\.status!="completed"/);
  assert.match(session,/const MAX_HISTORY:usize=64/);
  assert.match(session,/const MAX_BYTES:usize=96\*1024/);
  assert.match(session,/"automatic_execution":false/);
  assert.doesNotMatch(session,/executeTransaction|eval\(|create[A-Za-z]+Action/);
});
