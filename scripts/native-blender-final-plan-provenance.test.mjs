import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const delivery=readFileSync(new URL("../src-tauri/src/native_task_delivery.rs",import.meta.url),"utf8");
const cert=readFileSync(new URL("../src-tauri/src/native_blender_action_artifact.rs",import.meta.url),"utf8");
test("completed Blender task delivery includes full approved-plan digest from exact UUID certificate",()=>{
 assert.match(delivery,/approved_plan_sha256:Option<String>/);
 assert.match(delivery,/fn fill_blender_plan_provenance<F>/);
 assert.match(delivery,/fill_blender_plan_provenance\(&mut steps,\|id\|/);
 assert.match(delivery,/approved_plan_sha256:cert\.plan_sha256/);
 assert.match(delivery,/claimed\.path!=cert\.path/);
 assert.match(delivery,/claimed\.sha256!=cert\.sha256\|\|claimed\.bytes!=cert\.bytes/);
 assert.match(delivery,/exact_provenance_autofills_without_replacing_user_supplied_artifact_fields/);
});
test("delivery read checks stored input provenance against rehashed exact worker certificate",()=>{
 assert.match(delivery,/verify_blender_certificates\(app,&stored\.steps\)\?/);
 assert.match(delivery,/cert\.plan_sha256\.as_deref\(\)!=Some\(digest\)/);
 assert.match(delivery,/foreign_output_or_wrong_plan_digest_never_gains_verified_provenance/);
 assert.match(cert,/plan_sha256:Option<String>/);
 assert.doesNotMatch(delivery,/tauri::command|invoke_handler/);
});
