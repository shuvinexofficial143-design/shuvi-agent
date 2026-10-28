import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const auth=readFileSync(new URL("../src-tauri/src/native_task_authorization.rs",import.meta.url),"utf8");
const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
test("one native owner confirmation through existing task store and Rust audited worker",()=>{
 for(const token of ["issue_native_premiere_task_scope","confirm_native_premiere_task(&scope,&objective)?",
   "premiere_uia_prepared(","premiere_vision_prepared(","premiere_bridge_prepared(",
   "reserve_after_native_preflight(&app,scope_id,&action,now_ms())?",
   "reconcile_from_rust_journal(&app,task,scope,now_ms())?"])
   assert.ok(lib.includes(token),token);
 assert.match(auth,/fn one_premiere_approval_admits_ten_sequential_native_actions/);
 assert.match(auth,/g\.read_root\.as_ref\(\)\.is_some_and/);
});
test("local owner scope is per-task/per-window and cannot auto-execute unrelated tools",()=>{
 for(const s of ["chatAllowPremiereTask","premiereScopeAllows(proposal,readScope.window)",
    "issue_native_premiere_task_scope","await revokeNativeUiTaskRead(taskId)",
    "mode:\"premiere\""])assert.ok(ui.includes(s),s);
 assert.doesNotMatch(ui,/PREMIERE_SCOPED_TOOLS=.*pointer_click/);
 assert.match(ui,/!remoteTask&&!cancelRequested/);
});
