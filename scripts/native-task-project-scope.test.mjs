import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const policy=readFileSync(new URL("../src-tauri/src/native_task_project_scope.rs",import.meta.url),"utf8");
test("project scope enforces exact root under Rust execution lock before worker",()=>{
 const body=lib.slice(lib.indexOf("async fn execute_action("),lib.indexOf("fn execute_powershell(",lib.indexOf("async fn execute_action(")));
 const lock=body.indexOf("claim_monitored_native_execution(");
 const grant=body.indexOf(".consume(task,scope_id,&action_id,&prepared.action,&root,now_ms())");
 const worker=body.indexOf("native_worker_job::begin(");
 assert.ok(lock>=0&&grant>lock&&worker>grant);
 assert.ok(body.includes("project_scope_id: Option<String>"));
 assert.ok(body.includes("grant_id.is_some()||edit_scope_id.is_some()||inspection_scope_id.is_some()"));
 assert.ok(lib.includes("issue_task_project_scope,")&&lib.includes("revoke_task_project_scopes,"));
});
test("selected root inventory never grants nested files, mutations or AI spend",()=>{
 for(const s of ["const TTL_MS:u64=180_000","const MAX_READS:u8=8",
 "crate::ToolAction::ListDirectory{path}","crate::ToolAction::WorkspaceScan{path}",
 "authorized_paid_requests:0","actual!=bound","file_type().is_symlink()",
 "grant.remaining-=1","grant.used.contains(action_id)"]){
  assert.ok(policy.includes(s),s);
 }
 assert.ok(!policy.includes("crate::ToolAction::ReadFile{path}"));
});
test("post-execution project root check precedes native audit and old shell stays unscoped",()=>{
 const check=lib.indexOf(".confirm(task,scope,&action_id,&root)");
 const audit=lib.indexOf('event: "executed".into()',check);
 assert.ok(check>=0&&audit>check);
 assert.ok(lib.includes("execute_action(action_id, None, None, None, None, None, state, app).await"));
});
