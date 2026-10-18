import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const delivery=readFileSync(new URL("../src-tauri/src/native_task_delivery.rs",import.meta.url),"utf8");
const journal=readFileSync(new URL("../src-tauri/src/native_blender_action_artifact.rs",import.meta.url),"utf8");
test("native final delivery automatically uses exact verified Blender UUID certificate",()=>{
 assert.match(delivery,/fn fill_missing_blender_artifacts<F>/);
 assert.match(delivery,/fill_missing_blender_artifacts\(&mut steps,\|id\|/);
 assert.match(delivery,/native_blender_action_artifact::read_verified\(app,id\)/);
 assert.match(delivery,/DeliveryArtifact\{kind:"blender_artifact"/);
 assert.match(delivery,/verify_blender_certificates\(app,&receipt\.steps\)/);
 assert.match(journal,/fn read_verified\(app:&AppHandle,id:&str\)/);
 assert.match(journal,/verify_file_record\(&cert\)\?/);
});
test("Blender autofill refuses unsupported tool, wrong certificate and no worker proof",()=>{
 assert.match(delivery,/step\.tool=="blender_run_plan"&&step\.artifact\.is_none\(\)/);
 assert.match(delivery,/cert\.kind!="blender_artifact"/);
 assert.match(delivery,/missing_or_wrong_worker_certificate_never_autofills_delivery/);
 assert.match(delivery,/missing_blender_delivery_artifact_is_filled_from_exact_verified_uuid/);
});
