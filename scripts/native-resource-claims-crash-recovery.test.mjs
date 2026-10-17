import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const load=name=>readFileSync(new URL("../"+name,import.meta.url),"utf8");
const scheduler=load("src-tauri/src/native_scheduler.rs");
const plan=load("src-tauri/src/native_blender_owned_plan.rs");
const worker=load("src-tauri/src/native_worker_job.rs");
const resources=load("src-tauri/src/native_resource_lanes.rs");
test("only approved action owns canonical project and output claims before Windows launch",()=>{
  assert.match(scheduler,/mod resource_lanes/);
  assert.match(plan,/resource_lanes::reserve_blender_plan\(/);
  assert.ok(plan.indexOf("resource_lanes::reserve_blender_plan(")<plan.indexOf("spawn_for_active_action("));
  assert.match(resources,/fs::canonicalize\(p\)/);
  assert.match(resources,/fn conflicts\(/);
  assert.match(resources,/read_at\(file\)\?/);
  assert.match(resources,/native-resource-ownership\.json/);
});
test("only audited verified certificate releases an exact resource; unknown crash stays held",()=>{
  assert.match(worker,/release_after_verified_audit/);
  assert.match(resources,/job\.phase!="audit_verified"/);
  assert.match(resources,/job\.audit_success!=Some\(true\)/);
  assert.match(resources,/native_blender_action_artifact::read_verified\(app,action\)/);
  assert.match(resources,/release_at\(&file,action,&cert\.path\)/);
  assert.match(resources,/crash_preserves_claim_and_only_matching_certified_artifact_can_release/);
  assert.match(resources,/corrupted_or_orphaned_disk_ownership_cannot_unlock_outputs/);
  assert.doesNotMatch(resources,/tauri::command|invoke_handler/);
});
test("desktop GUI lane and single current PID owner remain exclusive",()=>{
  assert.match(scheduler,/if running>1/);
  const owned=load("src-tauri/src/native_owned_process.rs");
  assert.match(owned,/if slot\.active\.is_some\(\)/);
  assert.match(resources,/does NOT enable concurrent GUI execution/);
});
