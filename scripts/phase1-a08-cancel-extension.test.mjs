import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
test("only exact known process-backed actions may request cancellation",()=>{
  const cancel=rust.slice(rust.indexOf("fn cancel_running_action("),rust.indexOf("async fn execute_action("));
  assert.match(cancel,/matches!\(action\.tool\.as_str\(\), "run_project_task" \| "powershell" \| "motion_graphics_run_remotion"\)/);
  assert.match(cancel,/Some\("run_project_task"\) \| Some\("powershell"\) \| Some\("motion_graphics_run_remotion"\)/);
  assert.match(cancel,/managed_process_identity_matches\(state\.inner\(\), pid\)\?/);
  assert.match(cancel,/running_action_children/);
  assert.match(cancel,/Some\(_\) \| None => return Ok\(false\)/);
  assert.match(cancel,/bounded_child::collect_with_deadline\(killer, Duration::from_secs\(10\)\)/);
});
test("manual shell run is registered and unregistered under exact action id",()=>{
  const block=rust.slice(rust.indexOf("ToolAction::PowerShell { command } =>",rust.indexOf("async fn execute_tool_with_action_id(")),rust.indexOf("\n        }\n    }\n}",rust.indexOf("ToolAction::PowerShell { command } =>",rust.indexOf("async fn execute_tool_with_action_id("))));
  assert.match(block,/running\.insert\(action_id\.to_string\(\), child_pid\)/);
  assert.match(block,/running\.remove\(action_id\)/);
  assert.match(block,/terminate_registered_process_tree\(state, child_pid\)/);
});
