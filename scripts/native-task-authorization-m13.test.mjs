import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const auth=readFileSync(new URL("../src-tauri/src/native_task_authorization.rs",import.meta.url),"utf8");
test("M1.3 real Rust dispatch accepts only separate native OS-approved task scope",()=>{
 assert.match(src,/fn issue_native_read_task_scope\(/);
 assert.match(src,/fn confirm_native_read_task\(/);
 assert.match(src,/MessageBoxW\(0,text\.as_ptr\(\),title\.as_ptr\(\),0x0000_0134\)/);
 assert.match(src,/let grant=grants\.issue\(scope,now_ms\(\)\)/);
 assert.match(src,/fn revoke_native_read_task_scope\(/);
 assert.match(src,/task_scope_id: Option<String>/);
 assert.match(src,/reserve_after_native_preflight\(&app,scope_id,&action,now_ms\(\)\)/);
 assert.match(src,/native_worker_job::begin\(&app,&action_id,&active_tool,now_ms\(\)\)/);
 assert.match(src,/native_worker_job::audit\(&app,&action_id,result\.success,now_ms\(\)\)/);
 assert.match(src,/reconcile_from_rust_journal\(&app,task,scope,now_ms\(\)\)/);
 assert.match(src,/issue_native_read_task_scope,\s+issue_native_value_task_scope,\s+revoke_native_read_task_scope,/);
});
test("M1.3 native scope does not delegate mutation or anonymous windows",()=>{
 assert.match(src,/M1\.3 only delegates named read-only UIA inspections/);
 assert.match(auth,/fn observed_read_root\(stdout:&str\)/);
 assert.match(src,/verify_native_read_output\(task,scope,&action_id,&result\.tool,&result\.stdout,now_ms\(\)\)/);
 assert.match(src,/owner_checkpoint_allows\(/);
 assert.match(auth,/pub\(crate\) fn native_read_target\(action:&crate::ToolAction\)/);
 assert.match(auth,/UiDiscover\{window\}/);
 assert.match(auth,/UiFind\{window:Some\(window\)/);
 assert.doesNotMatch(auth,/Some\(Risk::FileEdit\).*=>Some\(window\.as_str\(\)\)/);
});
test("M1.3 legacy dangerous command paths still require explicit authorization",()=>{
 assert.match(src,/if let Some\(scope_id\)=task_scope_id\.as_deref\(\)/);
 assert.match(src,/if let Some\(scope_id\)=premiere_read_scope_id\.as_deref\(\)/);
 assert.match(src,/if let Some\(scope_id\)=edit_scope_id\.as_deref\(\)/);
 assert.match(src,/else if grant_id\.is_some\(\)\|\|task_id\.is_some\(\)/);
 assert.match(src,/No UI clicks, typing, file edits, model spending or crash resume/);
});
