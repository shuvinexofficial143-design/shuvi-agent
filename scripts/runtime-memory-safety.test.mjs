import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("project validation watchdog enforces the managed 4 GB hard ceiling",()=>{
  assert.match(rust,/fn terminate_managed_process_tree\(pid: u32\) -> Result<bool, String>/);
  const start=rust.indexOf("ToolAction::RunProjectTask { path, task }");
  const end=rust.indexOf("ToolAction::GitStatus { path }",start);
  const block=rust.slice(start,end);
  assert.match(block,/let hard_limit_triggered = AtomicBool::new\(false\)/);
  assert.match(block,/std::thread::scope\(\|scope\|/);
  assert.match(block,/while managed_process_identity_matches\(state, child_pid\)\.unwrap_or\(false\)/);
  assert.match(block,/current_runtime_status\(state\)/);
  assert.match(block,/status\.over_hard_limit/);
  assert.match(block,/terminate_registered_process_tree\(state, child_pid\)/);
  assert.match(block,/Duration::from_millis\(250\)/);
  assert.match(block,/output\.status\.success\(\) && !exceeded_hard_limit/);
  assert.match(block,/4 GB hard RAM ceiling/);
});

test("hard-ceiling termination remains scoped to the Shuvi-managed validation root",()=>{
  const helper=rust.slice(
    rust.indexOf("fn terminate_managed_process_tree"),
    rust.indexOf("fn classify_powershell")
  );
  assert.match(helper,/taskkill/);
  assert.match(helper,/\["\/PID", pid_string\.as_str\(\), "\/T", "\/F"\]/);
  const run=rust.slice(
    rust.indexOf("ToolAction::RunProjectTask { path, task }"),
    rust.indexOf("ToolAction::GitStatus { path }")
  );
  assert.match(run,/register_managed_process\(state, child_pid\)/);
  assert.match(run,/terminate_registered_process_tree\(state, child_pid\)/);
  assert.doesNotMatch(run,/list_processes/);
});
