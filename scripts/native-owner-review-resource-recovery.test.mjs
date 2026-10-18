import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(p)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const job=read("src-tauri/src/native_worker_job.rs");
const resources=read("src-tauri/src/native_resource_lanes.rs");
const plan=read("src-tauri/src/native_blender_owned_plan.rs");
test("exact owner-reconciled verified audit can reclaim only rehashed exact resource",()=>{
 const reconcile=job.slice(job.indexOf("pub(crate) fn reconcile("),job.indexOf("pub(crate) fn begin("));
 assert.match(reconcile,/if verified_audit==Some\(true\)&&tool=="blender_run_plan"/);
 assert.match(reconcile,/native_blender_action_artifact::read_verified\(app,id\)\?/);
 assert.ok(reconcile.indexOf("native_blender_action_artifact::read_verified(app,id)")<
           reconcile.indexOf("review_process_receipt_for_owner(app,id,tool)"));
 assert.match(reconcile,/review_process_receipt_for_owner\(app,id,tool\)\?/);
 assert.match(reconcile,/reconcile_at\(&journal_path\(app\)\?,id,tool,verified_audit,now\)\?/);
 assert.match(reconcile,/if reviewed\.audit_success==Some\(true\)/);
 assert.match(reconcile,/release_after_verified_audit\(app,id\)\?/);
 assert.match(resources,/job\.phase!="audit_verified"/);
 assert.match(resources,/native_blender_action_artifact::read_verified\(app,action\)/);
 assert.match(resources,/release_at\(&file,action,&cert\.path,cert\.plan_sha256\.as_deref\(\)\)/);
});
test("missing OS desktop lease is rejected before output reservation",()=>{
 assert.match(plan,/if slot\.is_none\(\)/);
 assert.ok(plan.indexOf("if slot.is_none()")<plan.indexOf("resource_lanes::reserve_blender_plan("));
 assert.ok(plan.indexOf("resource_lanes::reserve_blender_plan(")<plan.indexOf("spawn_for_active_action("));
 assert.match(resources,/owner review/i);
});
