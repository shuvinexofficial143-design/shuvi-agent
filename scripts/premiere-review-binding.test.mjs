import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rust=readFileSync("src-tauri/src/lib.rs","utf8");
const binding=readFileSync("src-tauri/src/premiere_review_binding.rs","utf8");

test("review resolver and binder are read-only typed routes with grounded native inspection",()=>{
  for(const name of ["premiere_resolve_review_target","premiere_bind_review_fix"]){
    assert.ok(rust.includes(`"${name}" |`) || rust.includes(`| "${name}"`));
  }
  assert.match(binding,/session\.sample_times\.contains\(&seconds\)/);
  assert.match(binding,/issue\.frame_seconds\.contains\(&seconds\)/);
  assert.match(binding,/targetSignature/);
  assert.match(binding,/componentsTruncated/);
  assert.doesNotMatch(binding,/eval\(|executeTransaction|create[A-Za-z]+Action/);
});
