import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const scope=readFileSync(new URL("../src-tauri/src/native_premiere_read_scope.rs",import.meta.url),"utf8");
const ui=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
test("Premiere scope cannot authorize UI mutations, relaunch or arbitrary editor",()=>{
 assert.match(scope,/PremiereLaunch\{project:None\}/);
 assert.match(scope,/\(0,crate::ToolAction::UiWindows\)/);
 assert.match(scope,/\(1,crate::ToolAction::UiDiscover\{window\}\)/);
 assert.match(scope,/MAX_SCOPES:usize=8/);
 assert.match(scope,/const TTL_MS:u64=180_000/);
 assert.doesNotMatch(scope,/crate::ToolAction::UiClick|crate::ToolAction::UiSetValue/);
});
test("each scope read has journal check and Rust independently verifies launcher and HWND/PID",()=>{
 assert.match(rust,/native_task_edit_scope::owner_checkpoint_allows\(record.as_ref\(\),task/);
 assert.match(rust,/read_action_audit_receipt\(&app,&origin\)/);
 assert.match(rust,/scopes\.consume\(task,scope_id,&action_id,&prepared.action,now_ms\(\)\)/);
 assert.match(rust,/\.confirm\(task,scope,&action_id,&result.stdout\)/);
 assert.match(scope,/ObservedWindowProcessStartTicks/);
 assert.match(scope,/NativeWindowHandle/);
 assert.match(rust,/issue_premiere_read_scope,/);
});
test("UI requires explicit owner click and original Rust audit, never a browser-only bypass",()=>{
 assert.match(ui,/premiereScopeApprove\.addEventListener\("click"/);
 assert.match(ui,/issue_premiere_read_scope/);
 assert.match(ui,/premiereReadScopeId:premiere.id/);
 assert.match(ui,/activePremiere\(pending.threadId,pending.proposal\?\?undefined\)/);
 assert.match(ui,/revoke_premiere_read_scope/);
});

test("owner Deny and Stop both revoke native Premiere read delegation without replay",()=>{
 const denied=rust.slice(rust.indexOf("fn deny_action("),rust.indexOf("/// Domain-separated native child identity."));
 const stopped=rust.slice(rust.indexOf("fn cancel_running_action("),rust.indexOf("async fn execute_action(",rust.indexOf("fn cancel_running_action(")));
 for(const source of [denied,stopped]){
  assert.match(source,/premiere_read_scopes\.lock\(\)/);
  assert.match(source,/\.revoke_action\(&action_id\)/);
 }
 assert.match(ui,/revoke_premiere_read_scope/);
});
