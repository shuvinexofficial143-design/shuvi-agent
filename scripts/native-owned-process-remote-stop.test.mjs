import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const worker=readFileSync(new URL("../src-tauri/src/native_owned_process.rs",import.meta.url),"utf8");
test("owner stop requests exact native action UUID via existing cancellation IPC",()=>{
 assert.match(lib,/fn cancel_running_action\(/);
 assert.match(lib,/Some\("blender_inspect"\) \| Some\("blender_run_plan"\)/);
 assert.match(lib,/return native_scheduler::owned_process::request_cancel_exact_persisted\(&app,&action_id\)/);
 assert.match(worker,/fn request_cancel_exact\(id:&str\)->Result<bool,String>/);
 assert.match(worker,/slot\.active\.as_deref\(\)!=Some\(id\)/);
 assert.match(worker,/slot\.cancel_requested=true/);
 assert.doesNotMatch(worker,/taskkill|Command::new\("taskkill"\)/);
});
test("owned worker polls cancellation and terminates only its retained Job Object",()=>{
 assert.match(worker,/if cancelled \{return self\.stop_owned_tree\("cancelled"\);\}/);
 assert.match(worker,/self\.child\.terminate_tree\(\)\?/);
 assert.match(worker,/owner\.cancel_requested=false/);
 assert.match(worker,/self\.complete_owned_terminal\(phase,result\)/);
 assert.match(worker,/self\.record_terminal\(actual,code\)\?/);
});
