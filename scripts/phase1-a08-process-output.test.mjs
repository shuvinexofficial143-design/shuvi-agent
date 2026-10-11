import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
test("project task cannot wait or collect unlimited output",()=>{
 const start=rust.indexOf("ToolAction::RunProjectTask { path, task } =>",rust.indexOf("async fn execute_tool_with_action_id("));
 const end=rust.indexOf("ToolAction::GitStatus { path }",start);
 assert.ok(end>start);
 const body=rust.slice(start,end);
 assert.match(body,/bounded_child::collect_with_deadline\(\s*child, Duration::from_secs\(600\)/);
 assert.doesNotMatch(body,/child\.wait_with_output\(\)/);
 assert.match(body,/register_managed_process\(state, child_pid\)/);
 assert.match(body,/running\.insert\(action_id\.to_string\(\), child_pid\)/);
});
test("Remotion timeout also limits output collection",()=>{
 const start=rust.indexOf("ToolAction::MotionGraphicsRunRemotion {request} =>",rust.indexOf("async fn execute_tool_with_action_id("));
 const end=rust.indexOf("\n        ToolAction::",start+40);
 assert.ok(end>start);
 const body=rust.slice(start,end);
 assert.match(body,/bounded_child::collect_with_deadline\(\s*child,timeout\.saturating_add\(Duration::from_secs\(5\)\)/);
 assert.doesNotMatch(body,/child\.wait_with_output\(\)/);
 assert.match(body,/timeout_terminated\.store/);
});
