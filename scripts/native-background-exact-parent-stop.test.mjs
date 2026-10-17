import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const queue=readFileSync(new URL("../src-tauri/src/native_background_parent_queue.rs",import.meta.url),"utf8");
const os=readFileSync(new URL("../src-tauri/src/native_background_os_workers.rs",import.meta.url),"utf8");
const ui=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");

test("M55 one exact approved active dispatch authenticates only the pinned parent UUIDs",()=>{
 assert.match(rust,/running_approved_parent_ids: Mutex<HashMap<String, \[String;2\]>>/);
 assert.match(rust,/fn require_live_approved_parent_stop_binding\(/);
 assert.match(rust,/running\.get\(dispatch_id\)\.map\(String::as_str\)!=Some\("run_approved_sha_parent_queue"\)/);
 assert.match(rust,/ids\[0\]!=parent_id&&ids\[1\]!=parent_id/);
 assert.match(rust,/fn m55_exact_stop_binding_cannot_reach_foreign_or_completed_parent/);
 assert.match(rust,/running_approved_parent_ids\.lock\(\)/);
 assert.match(rust,/bound\.remove\(&action_id\)/);
 assert.match(rust,/if let ToolAction::RunApprovedShaParentQueue\{first_parent_id,second_parent_id\}/);
});
test("M55 Stop only writes durable owned OS intent, never calls arbitrary kill or claims termination",()=>{
 assert.match(rust,/fn cancel_native_approved_parent\(/);
 assert.match(rust,/require_live_approved_parent_stop_binding\(state.inner\(\)/);
 assert.match(rust,/request_exact_parent_stop_at\(&root,&parent_id\)/);
 assert.match(rust,/event:"native_approved_parent_stop_intent"/);
 assert.match(rust,/success:false/);
 assert.match(queue,/fn request_exact_parent_stop_at\(/);
 assert.match(queue,/c\.phase=="os_running"&&c\.input_path==parent\.input_path/);
 assert.match(queue,/super::request_stop_for_child\(root,id\)/);
 assert.match(os,/fn request_stop_for_child\(/);
 const part=rust.slice(rust.indexOf("fn cancel_native_approved_parent("),rust.indexOf("#[tauri::command]\nfn cancel_running_action("));
 assert.doesNotMatch(part,/taskkill|TerminateProcess|Command::new|ownerApproved:\s*true/);
});
test("M55 UI shows per-parent Stop only for admitted record plus live approved native action",()=>{
 assert.match(ui,/parent\.recordedPhase==="admitted"&&host/);
 assert.match(ui,/host\.tool==="run_approved_sha_parent_queue"/);
 assert.match(ui,/host\.state==="native_action_in_flight"/);
 assert.match(ui,/invoke<boolean>\("cancel_native_approved_parent"/);
 assert.match(ui,/dispatchActionId:dispatchId,parentId:parent\.parentId/);
 assert.match(ui,/window\.confirm\("Request Stop for EXACT SHA parent "/);
 assert.match(ui,/OS termination NOT verified/);
 assert.doesNotMatch(ui,/invoke<boolean>\("cancel_native_approved_parent",\{pid:/);
});