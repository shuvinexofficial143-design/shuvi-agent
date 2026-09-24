import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const desktop=readFileSync("src-tauri/src/lib.rs","utf8");
const source=readFileSync("src-tauri/src/premiere_acceptance_execution.rs","utf8");

test("acceptance executor is one preplanned typed action under existing approval and native post-inspection",()=>{
  for(const name of ["premiere_acceptance_prepare","premiere_acceptance_execute","premiere_acceptance_cancel"]){
    assert.ok(desktop.includes(`"${name}"`));
  }
  assert.match(desktop,/PremiereAcceptanceExecute[\s\S]*?RiskLevel::High/);
  assert.match(desktop,/PremiereAcceptanceExecute \{action_id\}[\s\S]*?Registration|premiere_disposable_path\(app\)/);
  assert.match(desktop,/Box::pin\(execute_tool\(inner,state,app\)\)/);
  assert.match(desktop,/record\.finish\(&after,true\)/);
  assert.match(source,/"trim"\|"move"\|"clone"/);
  assert.match(source,/native_accepted && verify/);
  assert.doesNotMatch(source,/eval\(|executeTransaction|std::process::Command/);
});
