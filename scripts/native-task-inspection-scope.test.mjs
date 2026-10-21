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

test("legacy manual PowerShell wrapper supplies explicit empty inspection scope",()=>{
 assert.ok(lib.includes("execute_action(action_id, None, None, None, None, state, app).await"));
 assert.ok(!lib.includes("execute_action(action_id, None, None, None, state, app).await"));
});

test("native executor pins HWND, PID and process generation before returning scoped UI read",()=>{
 assert.ok(scope.includes("ObservedWindowHwnd"));
 assert.ok(scope.includes("ObservedWindowPid"));
 assert.ok(scope.includes("ObservedWindowProcessStartTicks"));
 assert.ok(scope.includes("s.origin!=action_id"));
 assert.ok(scope.includes("if bound!=&actual"));
 const verify=lib.indexOf(".record_audited_read(task,scope,&action_id,&result.stdout)");
 const publish=lib.indexOf("match execution {",verify);
 const audited=lib.indexOf("event: \"executed\".into()",verify);
 assert.ok(verify>=0&&audited>verify,"OS root must be verified BEFORE a successful native action audit");
 assert.ok(scope.includes("if verdict.is_err(){self.scopes.remove(scope);}"));
});

test("the OS generation metadata check compares dereferenced &str (Rust E0277 regression)",()=>{
 assert.ok(scope.includes('v.bytes().all(|c|c.is_ascii_digit())&&*v!="0"'));
 assert.ok(!scope.includes('v.bytes().all(|c|c.is_ascii_digit())&&v!="0"'));
});
