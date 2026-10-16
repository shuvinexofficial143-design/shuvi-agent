import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const owner=readFileSync(new URL("../src-tauri/src/native_blender_owned_plan.rs",import.meta.url),"utf8");
const delivery=readFileSync(new URL("../src-tauri/src/native_task_delivery.rs",import.meta.url),"utf8");
const artifact=readFileSync(new URL("../src-tauri/src/native_blender_action_artifact.rs",import.meta.url),"utf8");
const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
test("Rust records verified Blender output certificate for the real scheduled action UUID",()=>{
 assert.match(lib,/mod native_blender_action_artifact;/);
 assert.match(owner,/native_blender_action_artifact::record_verified\(app,action_id,&verified\)/);
 assert.match(owner,/child\.reclaim_terminal_lease\(\)\?/);
 assert.match(owner,/native_plan_response\(&evidence\.0,&root,Path::new\(output_dir\),render\)\?/);
 assert.match(artifact,/create_new_verified/);
 assert.match(artifact,/verify_file_record\(record\)/);
});
test("native task delivery rejects unrelated Blender file/hash receipts even if file exists",()=>{
 assert.match(delivery,/step\.tool=="blender_run_plan"/);
 assert.match(delivery,/native_blender_action_artifact::require_exact\(/);
 assert.match(artifact,/record\.path!=path\|\|record\.sha256!=sha256\|\|record\.bytes!=bytes/);
 assert.match(artifact,/modified_file_or_claimed_sha256_cannot_be_delivered/);
 assert.match(artifact,/action_bound_disk_receipt_survives_restart_and_rejects_foreign_uuid/);
 assert.doesNotMatch(artifact,/tauri::command|invoke_handler/);
});
