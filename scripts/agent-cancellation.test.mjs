import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("running project task is correlated to the exact prepared action ID",()=>{
  assert.match(rust,/running_action_children: Mutex<HashMap<String, u32>>/);
  assert.match(rust,/async fn execute_tool_with_action_id\(/);
  assert.match(rust,/execution_action_id: Option<&str>/);
  const run=rust.slice(rust.indexOf("ToolAction::RunProjectTask { path, task }"),rust.indexOf("ToolAction::GitStatus { path }"));
  assert.match(run,/running\.insert\(action_id\.to_string\(\), child_pid\)/);
  assert.match(run,/running\.remove\(action_id\)/);
  const execute=rust.slice(rust.indexOf("async fn execute_action("),rust.indexOf("async fn execute_powershell"));
  assert.match(execute,/execute_tool_with_action_id\(action, state\.inner\(\), &app, Some\(action_id\.as_str\(\)\)\)/);
});

test("cancel_running_action only targets the child registered for that action UUID",()=>{
  const cancel=rust.slice(rust.indexOf("fn cancel_running_action("),rust.indexOf("async fn execute_action("));
  assert.match(cancel,/Uuid::parse_str\(&action_id\)/);
  assert.match(cancel,/running\.get\(&action_id\)\.copied\(\)/);
  assert.match(cancel,/managed_children[\s\S]*contains\(&pid\)/);
  assert.match(cancel,/taskkill/);
  assert.match(cancel,/running\.remove\(&action_id\)/);
  assert.doesNotMatch(cancel,/arg_u32/);
  assert.match(rust,/cancel_running_action,[\s\S]*execute_action/);
});
