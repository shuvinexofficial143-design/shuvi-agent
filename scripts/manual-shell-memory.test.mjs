import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("manual shell is registered as a Shuvi-managed process",()=>{
  const start=rust.indexOf("ToolAction::PowerShell { command } =>");
  const end=rust.indexOf("\n        }\n    }\n}",start)+10;
  const block=rust.slice(start,end);
  assert.match(block,/\.stdout\(Stdio::piped\(\)\)/);
  assert.match(block,/\.stderr\(Stdio::piped\(\)\)/);
  assert.match(block,/\.spawn\(\)/);
  assert.match(block,/let child_pid = child\.id\(\)/);
  assert.match(block,/state\.managed_children\.lock\(\)/);
  assert.match(block,/managed\.insert\(child_pid\)/);
  assert.match(block,/managed\.remove\(&child_pid\)/);
  assert.doesNotMatch(block,/\.output\(\)/);
});

test("manual shell is stopped if tracking registration fails",()=>{
  const start=rust.indexOf("ToolAction::PowerShell { command } =>");
  const block=rust.slice(start,start+7000);
  assert.match(block,/terminate_managed_process_tree\(child_pid\)/);
  assert.match(block,/manual shell was stopped before it could remain untracked/);
  assert.match(block,/child\.wait\(\)/);
});

test("manual shell watchdog fails closed above the 4 GB RAM ceiling",()=>{
  const start=rust.indexOf("ToolAction::PowerShell { command } =>");
  const block=rust.slice(start,start+7000);
  assert.match(block,/while process_is_alive\(child_pid\)/);
  assert.match(block,/current_runtime_status\(state\)/);
  assert.match(block,/status\.over_hard_limit/);
  assert.match(block,/Duration::from_millis\(250\)/);
  assert.match(block,/output\.status\.success\(\) && !exceeded_hard_limit/);
  assert.match(block,/4 GB hard RAM ceiling/);
});
