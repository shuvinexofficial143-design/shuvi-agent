import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const scope=readFileSync(new URL("../src-tauri/src/native_task_inspection_scope.rs",import.meta.url),"utf8");
test("inspection permission has independent Rust pre-worker guard",()=>{
 const action=lib.slice(lib.indexOf("async fn execute_action("),lib.indexOf("fn execute_powershell(",lib.indexOf("async fn execute_action(")));
 const lease=action.indexOf("claim_monitored_native_execution(");
 const consume=action.indexOf(".consume(task,scope_id,&action_id,&prepared.action,now_ms())");
 const job=action.indexOf("native_worker_job::begin(");
 assert.ok(lease>=0&&consume>lease&&job>consume);
 assert.ok(action.includes('"executing",now_ms()'));
 assert.ok(action.includes("grant_id.is_some()||edit_scope_id.is_some()"));
 assert.ok(lib.includes("issue_task_inspection_scope,"));
 assert.ok(lib.includes("revoke_task_inspection_scopes,"));
});
test("inspection scope is read-only, bounded and non-billing",()=>{
 assert.ok(scope.includes("const TTL_MS:u64=180_000"));
 assert.ok(scope.includes("const MAX_ACTIONS:u8=8"));
 assert.ok(scope.includes('crate::ToolAction::UiFind{window:Some(window),name,automation_id}'));
 assert.ok(scope.includes('crate::ToolAction::UiDiscover{window}'));
 assert.ok(scope.includes("authorized_paid_requests:0"));
 assert.ok(scope.includes("s.window!=window"));
 assert.ok(scope.includes("s.consumed.contains(action_id)"));
 assert.ok(scope.includes("revoke_action"));
});
