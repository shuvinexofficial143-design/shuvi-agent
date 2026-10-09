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
  assert.match(block,/register_managed_process\(state, child_pid\)/);
  assert.match(block,/unregister_managed_process\(state, child_pid\)/);
  assert.doesNotMatch(block,/\.output\(\)/);
});

test("manual shell is stopped if tracking registration fails",()=>{
  const start=rust.indexOf("ToolAction::PowerShell { command } =>");
  const block=rust.slice(start,start+7000);
  assert.match(block,/terminate_managed_process_tree\(child_pid\)/);
  assert.match(block,/Manual shell was stopped before it could remain untracked/);
  assert.match(block,/child\.wait\(\)/);
});

test("manual shell watchdog fails closed above the 4 GB RAM ceiling",()=>{
  const start=rust.indexOf("ToolAction::PowerShell { command } =>");
  const block=rust.slice(start,start+7000);
  assert.match(block,/while managed_process_identity_matches\(state, child_pid\)\.unwrap_or\(false\)/);
  assert.match(block,/current_runtime_status\(state\)/);
  assert.match(block,/status\.over_hard_limit/);
  assert.match(block,/Duration::from_millis\(250\)/);
  assert.match(block,/output\.status\.success\(\) && !exceeded_hard_limit/);
  assert.match(block,/4 GB hard RAM ceiling/);
});

test("manual Permission Lab shell has a finite process deadline and bounded concurrent output",()=>{
  const start=rust.indexOf("ToolAction::PowerShell { command } =>");
  const end=rust.indexOf("\n        }\n    }\n}",start);
  const block=rust.slice(start,end);
  assert.match(block,/bounded_child::collect_with_deadline\(/);
  assert.match(block,/child, Duration::from_secs\(120\)/);
  assert.match(block,/register_managed_process\(state, child_pid\)/);
  assert.match(block,/unregister_managed_process\(state, child_pid\)/);
  assert.doesNotMatch(block,/child\.wait_with_output\(\)/);
});
