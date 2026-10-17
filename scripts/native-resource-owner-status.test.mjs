import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=x=>readFileSync(new URL("../src-tauri/src/"+x,import.meta.url),"utf8");
const resources=read("native_resource_lanes.rs");
const worker=read("native_worker_status.rs");
const lib=read("lib.rs");
test("existing native worker status attaches serialized cross-process ownership",()=>{
 assert.match(lib,/let resources=native_scheduler::resource_lanes::snapshot\(&app\)\?/);
 assert.match(lib,/native_worker_status::attach_resource_ownership\(/);
 assert.match(resources,/let _os=CrossProcessLedgerLock::take\(file\)\?/);
 assert.match(resources,/fn snapshot_at\(/);
 assert.match(worker,/pub resource_claims:Vec</);
 assert.match(worker,/pub resource_held_count:usize/);
});
test("owner can inspect unknown output holds without fake liveness or automatic resource release",()=>{
 assert.match(resources,/evidence_verified:false,safe_to_auto_retry:false/);
 assert.match(resources,/orphaned_or_previous_action_requires_owner_review/);
 assert.match(worker,/orphaned_resource_forces_recovery_not_idle_or_autoretry/);
 assert.match(resources,/resource_snapshot_rejects_corruption_and_cross_process_contention/);
 assert.doesNotMatch(resources,/tauri::command/);
});
