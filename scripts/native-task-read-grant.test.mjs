import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const normalize=text=>text.replaceAll("\r\n","\n");
const rust=normalize(readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8"));
const grants=normalize(readFileSync(new URL("../src-tauri/src/native_task_grant.rs",import.meta.url),"utf8"));
const ui=normalize(readFileSync(new URL("../src/main.ts",import.meta.url),"utf8"));

test("Rust never authorizes a write, UI click, powershell or untyped action under a reused read grant",()=>{
  // Inspect only the actual production allowlist, not negative Rust test fixtures.
  const allowlist=grants.slice(grants.indexOf('const READ_TOOLS:'),grants.indexOf('];',grants.indexOf('const READ_TOOLS:'))+2);
  for(const blocked of ['write_file','ui_click','powershell','premiere_insert_media','after_effects_run','blender_run_plan']){
    assert.equal(allowlist.includes('"'+blocked+'"'),false,blocked);
  }
  for(const safe of ['read_file','list_directory','ui_find','list_processes','browser_dom_read',
     'git_status','git_diff','premiere_context']){
    assert.ok(allowlist.includes('"'+safe+'"'),safe);
  }
  assert.match(grants,/let raw=serde_json::to_vec\(arguments\)\.ok\(\)\?/);
  assert.match(grants,/hasher\.update\(tool\.as_bytes\(\)\)/);
  assert.match(grants,/hasher\.update\(&raw\)/);
});

test("Rust binds native action's low risk and exact arguments at staging",()=>{
  assert.match(rust,/grant_signature=if matches!\(&risk,RiskLevel::Low\)/);
  assert.match(rust,/native_task_grant::read_signature\(&tool,&proposal\.arguments\)/);
  assert.match(rust,/grant_signature,\s*native_uia_target,\s*capture_target,\s*premiere_expectation,\s*task_graph: proposal\.task_graph\.clone\(\)/);
  assert.match(rust,/let sig=action\.grant_signature\.as_deref\(\)/);
  assert.match(rust,/grants\.issue\(&task_id,sig,now_ms\(\)\)/);
});

test("Granted native execution is checked and consumed before scheduler or action start",()=>{
  const execute=rust.slice(rust.indexOf("async fn execute_action("));
  assert.match(execute,/if grant_id\.is_some\(\)\|\|task_id\.is_some\(\)/);
  assert.match(execute,/prepared\.grant_signature\.as_deref\(\)/);
  const consume=execute.indexOf("grants.consume(task,id,sig,now_ms())?");
  const journal=execute.indexOf("native_worker_job::begin(");
  assert.ok(consume>0 && journal>consume,"Rust authority consumed before execution/journal");
  assert.match(execute,/let id=grant_id\.as_deref\(\)\.ok_or/);
  assert.match(execute,/let task=task_id\.as_deref\(\)\.ok_or/);
  assert.match(grants,/if grant\.task_id!=task_id \|\| grant\.signature!=signature/);
});

test("A UI owner click, not a model reply, issues the exact native grant",()=>{
  const ownerClick=ui.slice(ui.indexOf('if (allowSession) {'));
  assert.match(ownerClick,/allowSession\.onclick = async \(\) =>/);
  assert.match(ownerClick,/invoke<string>\("issue_task_read_grant"/);
  assert.match(ownerClick,/taskId:ownerTaskId,actionId:pendingId/);
  assert.match(ownerClick,/nativeReadGrantIds\.set\(key,grantId\)/);
  const auto=ui.slice(ui.indexOf('const exactReadKey=taskReadPermissionKey(proposal)'));
  assert.match(auto,/const rustGrantId=exactReadKey\?nativeReadGrantIds\.get\(exactReadKey\):null/);
  assert.match(auto,/await executePendingProposal\(proposal,rustGrantId\)/);
  assert.match(ui,/rustGrantId\?\{actionId,grantId:rustGrantId,taskId:permissionTaskId\}:\{actionId\}/);
});

test("Grant is revoked by owner Stop, Deny, task rotation and final checkpoint",()=>{
  assert.match(ui,/async function revokeNativeTaskReads\(taskId:string\)/);
  assert.match(ui,/invoke\("revoke_task_read_grants",\{taskId\}\)/);
  for(const fragment of [
    'await revokeNativeTaskReads(stoppedTaskId)',
    'await revokeNativeTaskReads(stoppingReadTaskId)',
    'await revokeNativeTaskReads(deniedTaskId)',
    'await revokeNativeTaskReads(finishedTaskId)',
    'void revokeNativeTaskReads(oldId)'
  ])assert.ok(ui.includes(fragment),fragment);
  assert.match(grants,/self\.entries\.retain\(\|_,grant\|grant\.task_id!=task_id\)/);
});

test("Read grants cannot survive restart or escape their 5-minute eight-use expiry",()=>{
  assert.match(grants,/const TTL_MS:u64=5\*60\*1000/);
  assert.match(grants,/const MAX_USES:u8=8/);
  assert.match(grants,/pub\(crate\) struct TaskReadGrantStore/);
  assert.match(rust,/task_read_grants: Mutex<native_task_grant::TaskReadGrantStore>/);
  assert.doesNotMatch(rust,/serialize\(&state\.task_read_grants\)/);
  assert.match(grants,/self\.entries\.retain\(\|_,grant\|now<grant\.expires_at_ms && grant\.remaining>0\)/);
  assert.match(grants,/grant\.remaining-=1/);
});

test("New native IPC commands are registered and retain existing explicit approval path",()=>{
  assert.match(rust,/issue_task_read_grant,\s*revoke_task_read_grants,\s*deny_action/);
  assert.match(rust,/async fn execute_action\(\s*action_id: String,\s*grant_id: Option<String>,\s*task_id: Option<String>/);
  assert.match(rust,/execute_action\(action_id, None, None, None, None, None, state, app\)\.await/);
  assert.match(rust,/inspection_scope_id: Option<String>/);
  assert.match(ui,/const approve = chatPermission\.querySelector<HTMLButtonElement>\("#chatApprove"\)/);
});

test("Owner can revoke read reuse explicitly without aborting a running task",()=>{
  assert.match(ui,/id="revokeTaskReadGrants" type="button" disabled/);
  assert.match(ui,/el<HTMLButtonElement>\("#revokeTaskReadGrants"\)\.addEventListener\("click",async/);
  assert.match(ui,/const confirmed=await revokeNativeTaskReads\(taskId\)/);
  assert.match(ui,/button\.textContent=confirmed\?"Read grants revoked":"Read reuse disabled; Rust revoke unconfirmed"/);
  assert.match(ui,/el<HTMLButtonElement>\("#revokeTaskReadGrants"\)\.disabled=false/);
});
