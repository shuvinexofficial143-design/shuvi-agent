import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const scope=readFileSync(new URL("../src-tauri/src/native_task_edit_scope.rs",import.meta.url),"utf8");
const native=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");

test("scope cannot be granted from model text or a read permission",()=>{
 assert.ok(rust.includes('fn issue_task_edit_scope('));
 assert.ok(rust.includes('pending.get(&action_id)'));
 assert.ok(rust.includes('ToolAction::WriteFile{path,..}|ToolAction::ReplaceText{path,..}=>path'));
 assert.ok(rust.includes('issue_task_read_grant,'));
 assert.ok(rust.includes('revoke_task_read_grants,'));
 assert.ok(rust.includes('issue_task_edit_scope,'));
 assert.ok(rust.includes('revoke_task_edit_scopes,'));
 const allow=scope.slice(scope.indexOf('const ALLOWED:'),scope.indexOf(';',scope.indexOf('const ALLOWED:'))+1);
 assert.match(allow,/write_file/);
 assert.match(allow,/replace_text/);
 for(const op of ['powershell','git_push','ui_click','browser_dom_click','run_project_task'])
  assert.ok(!allow.includes(op),op);
});

test("Rust consumes exact edit file authority under native ownership before worker start",()=>{
 const execute=rust.slice(rust.indexOf("async fn execute_action("),rust.indexOf("async fn execute_powershell("));
 const lease=execute.indexOf("claim_monitored_native_execution");
 const consume=execute.indexOf(".consume(task,scope_id,&action_id,&prepared.tool,path,&workspace,now_ms())?");
 const begin=execute.indexOf("native_worker_job::begin(");
 assert.ok(lease>=0&&consume>lease&&begin>consume);
 assert.ok(execute.includes('Cannot combine read grant and edit scope.'));
 assert.ok(execute.includes('Scoped editing cannot authorize this native tool.'));
 assert.ok(execute.includes('task_id.as_deref().ok_or("Scoped editing needs exact task ID.")?'));
 assert.ok(scope.includes('checked_file(path)?'));
 assert.ok(scope.includes('snapshot(&checked)?!=s.file_snapshot'));
 assert.ok(scope.includes('record_audited_success(&mut self'));
 assert.ok(rust.includes('scopes.record_audited_success(task,scope_id,&action_id,path,&workspace)?'));
 assert.ok(rust.includes('let scoped_file_path=if edit_scope_id.is_some()'));
 assert.ok(rust.includes('let path=scoped_file_path.as_deref()'));
 assert.ok(rust.includes('if let Ok(mut scopes)=state.task_edit_scopes.lock(){scopes.revoke_action(&action_id);}'));
 assert.ok(scope.includes('selected_workspace!=s.workspace'));
 assert.ok(scope.includes('!exact_file.starts_with(&selected_workspace)'));
 assert.ok(rust.includes('Select a Shuvi project workspace before issuing task editing scope.'));
 assert.ok(rust.includes('Selected project workspace disappeared before scoped execution.'));
 assert.ok(scope.includes('s.task_id!=task_id||s.tool!=tool'));
 assert.ok(scope.includes('s.dispatched.contains(action_id)'));
 assert.ok(scope.includes('selected_workspace!=s.workspace||checked!=s.exact_file'));
});

test("scope has finite time and uses, no paid request authority and no persistent grant",()=>{
 assert.ok(scope.includes('const TTL_MS:u64=10*60*1000'));
 assert.ok(scope.includes('const MAX_ACTIONS:u8=4'));
 assert.ok(scope.includes('authorized_paid_requests:0'));
 assert.ok(scope.includes('scopes:HashMap<String,Scope>'));
 assert.ok(rust.includes('task_edit_scopes: Mutex<native_task_edit_scope::TaskEditScopeStore>'));
 assert.ok(rust.includes('.revoke_action(&action_id)'));
 assert.ok(scope.includes('meta.file_attributes()&0x400!=0'));
 assert.ok(scope.includes('Component::CurDir|Component::ParentDir'));
 assert.ok(scope.includes('Scoped edit forbids Windows stream or ambiguous filename.'));
 assert.ok(scope.includes('Scoped edit forbids reserved Windows device filename.'));
 assert.ok(scope.includes('Scoped edits require a local drive, never UNC or device namespace.'));
 assert.ok(scope.includes('revoke_task(&mut self,task_id:&str)'));
});

test("owner UI click explicitly requests narrow scope; generic Allow once remains",()=>{
 assert.ok(native.includes('editScopeApprove.addEventListener("click",async()=>'));
 assert.ok(native.includes('"issue_task_edit_scope",{taskId,actionId:current.action.id}'));
 assert.ok(native.includes('scopedApprovalId=current.action.id;await decide(true);'));
 assert.ok(native.includes('scope.tool===current.action.kind&&scope.path===exactEditPath'));
 assert.ok(native.includes('editScopeId:scope.id,taskId:scope.taskId'));
 assert.ok(native.includes('approve.addEventListener("click",()=>{void decide(true);});'));
 assert.ok(native.includes('"revoke_task_edit_scopes",{taskId:active.taskId}'));
 assert.ok(native.includes('authorizedPaidRequests!==0'));
 // Each next stage stays behind explicit permission; no autonomous click bypass.
 assert.ok(native.includes('approval.hidden=false;'));
 assert.ok(native.includes('Master waiting for approval of next task step.'));
});

test("owner can explicitly revoke task editing scope without claiming process termination",()=>{
 assert.ok(native.includes('const revokeEditing=field("button","Revoke task editing scopes")'));
 assert.ok(native.includes('composerParent.insertBefore(revokeEditing,chatForm)'));
 assert.ok(native.includes('revokeEditing.addEventListener("click",async()=>'));
 assert.ok(native.includes('editScopes.clear();scopedApprovalId=null;refreshState();'));
 assert.ok(native.includes('"revoke_task_edit_scopes",{taskId}'));
 assert.ok(native.includes('this does not terminate an executing Windows action'));
 assert.ok(native.includes('editScopeApprove.disabled=sending||editScopeIssuing||editScopeRevoking||!ready'));
});
