import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
const native=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const kernel=readFileSync(new URL("../src-tauri/src/native_task_authorization.rs",import.meta.url),"utf8");
test("M1.4 approval is a Windows owner dialog and hash-bound reviewed objective",()=>{
 assert.match(ui,/chatAllowNativeUiTask/);
 assert.match(ui,/crypto\.subtle\.digest\("SHA-256"/);
 assert.match(ui,/invoke<string>\("issue_native_read_task_scope"/);
 assert.match(native,/fn confirm_native_read_task\(/);
 assert.match(native,/MessageBoxW\(0,text\.as_ptr\(\),title\.as_ptr\(\),0x0000_0134\)/);
 assert.match(native,/scope\.objective_digest/);
});
test("M1.4 only native-read bound same-window/task actions are auto-admitted",()=>{
 assert.match(ui,/function nativeUiTaskWindow\(p:ToolProposal\)/);
 assert.match(ui,/readScope\.taskId===activePermissionScope\.taskId/);
 assert.match(ui,/readScope\.window===nativeUiTaskWindow\(proposal\)/);
 assert.match(ui,/executePendingProposal\(proposal,null,readScope\.scopeId\)/);
 assert.match(ui,/taskScopeId\?\{actionId,taskId:permissionTaskId,taskScopeId\}/);
 assert.match(kernel,/fn observed_read_root\(stdout:&str\)/);
 assert.match(native,/reserve_after_native_preflight\(&app,scope_id,&action,now_ms\(\)\)/);
});
test("M1.4 Stop, task lifecycle and explicit owner revoke discard native scope",()=>{
 for(const id of ["oldId","finishedTaskId","stoppedTaskId","deniedTaskId","stoppingReadTaskId"]){
  assert.ok(ui.includes("revokeNativeUiTaskRead("+id+")"),id);
 }
 assert.match(ui,/nativeScopeRevoked=await revokeNativeUiTaskRead\(taskId\)/);
 assert.match(native,/fn revoke_native_read_task_scope\(/);
 assert.match(native,/native_worker_job::audit\(&app,&action_id,result.success,now_ms\(\)\)/);
});
test("M1.4 does not grant paid requests, edits, shell or UI mutations",()=>{
 assert.match(ui,/tools:\["ui_find","ui_discover"\],risks:\["read_only"\]/);
 assert.match(ui,/validForMs:1_200_000,maxActions:24,maxAiRequests:1/);
 assert.match(native,/M1\.3 only delegates named read-only UIA inspections/);
 assert.match(native,/No UI clicks, typing, file edits, model spending or crash resume/);
});
