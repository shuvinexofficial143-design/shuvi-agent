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

test("recovery verification cannot publish over a changed acceptance snapshot",()=>{
  const helper=source.slice(source.indexOf('pub fn save_recovery_result('),source.indexOf('#[derive'));
  assert.match(helper,/ACTION_IO.lock\(\)/);
  assert.match(helper,/encode\(&latest\)\?!=encode\(inspected\)\?/);
  assert.match(helper,/Recovery verification attempted to change unrelated acceptance state/);
  const recovery=desktop.slice(desktop.indexOf('ToolAction::PremiereAcceptanceVerifyRecovery {action_id} =>'),desktop.indexOf('ToolAction::PremiereAcceptanceExecute {action_id} =>'));
  assert.match(recovery,/let inspected_record=record.clone\(\)/);
  assert.match(recovery,/save_recovery_result\(&path,&inspected_record,&record\)/);
  assert.doesNotMatch(recovery,/premiere_acceptance_execution::save\(&path,&record\)/);
});

test("acceptance start and finish merge fresh cancellation under a store lock",()=>{
  const begin=source.slice(source.indexOf('pub fn begin('),source.indexOf('pub fn cancel('));
  assert.match(begin,/ACTION_IO.lock\(\)/);
  assert.match(begin,/latest.status!="prepared"/);
  assert.match(begin,/latest.cancellation_requested/);
  const progress=source.slice(source.indexOf('pub fn save_progress('),source.indexOf('#[derive'));
  assert.match(progress,/latest.status!="executing"/);
  assert.match(progress,/record.cancellation_requested\|=latest.cancellation_requested/);
  assert.match(desktop,/premiere_acceptance_execution::begin\(&path,&record\)/);
  const execution=desktop.slice(desktop.indexOf('ToolAction::PremiereAcceptanceExecute {action_id} =>'),desktop.indexOf('ToolAction::PremiereAcceptanceProbe {group} =>'));
  assert.doesNotMatch(execution,/premiere_acceptance_execution::save\(&path,&record\)/);
  assert.match(execution,/save_progress\(&path,&mut record\)/);
  assert.equal((desktop.match(/PendingAction\{created_at_ms:now_ms\(\),premiere_expectation:Some\(target.expected.clone\(\)\)/g)||[]).length,2);
});

test("persisted acceptance revalidates exact fixtures and backup recovery cannot replay prepared work",()=>{
  const validation=source.slice(source.indexOf('pub fn validate(&self)'),source.indexOf('pub fn identity('));
  assert.match(validation,/fixture.expected.clips.len\(\)!=1/);
  assert.match(validation,/fixture.clip_index!=clip.clip_index/);
  assert.match(validation,/self.before.get\("targetSignature"\)/);
  assert.match(validation,/n.abs\(\)<=3.0/);
  const load=source.slice(source.indexOf('pub fn load('),source.indexOf('pub fn save('));
  assert.match(load,/recovered.status="uncertain"/);
  assert.match(load,/recovered.recovery_verified=false/);
});
