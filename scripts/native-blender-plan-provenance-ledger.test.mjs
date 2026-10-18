import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const rust=readFileSync(new URL("../src-tauri/src/native_blender_owned_plan.rs",import.meta.url),"utf8");
const certificate=readFileSync(new URL("../src-tauri/src/native_blender_action_artifact.rs",import.meta.url),"utf8");
const python=readFileSync(new URL("../integrations/blender-worker/shuvi_blender_plan.py",import.meta.url),"utf8");
test("only a verified full approved plan hash can enter a newly published Blender certificate",()=>{
 assert.match(rust,/approved_plan_hash_matches\(&value,expected_plan_sha256\)\?/);
 assert.match(rust,/native_blender_action_artifact::record_verified\(app,action_id,&verified\)\?/);
 assert.match(python,/hashlib\.sha256\(staged_bytes\)\.hexdigest\(\)/);
 assert.match(certificate,/evidence\.get\("approved_plan_sha256"\)/);
 assert.match(certificate,/plan_sha256:Some\(plan_sha256\.to_string\(\)\)/);
 assert.match(certificate,/new_certificate_retains_exact_approved_plan_sha256_across_disk_reload/);
});
test("historical certificates remain distinct from verified plan-provenance certificates",()=>{
 assert.match(certificate,/#\[serde\(default,skip_serializing_if="Option::is_none"\)\]/);
 assert.match(certificate,/plan_sha256:Option<String>/);
 assert.match(certificate,/historical_v1_certificate_without_plan_hash_is_readable_but_not_upgraded/);
 assert.match(certificate,/digest\.len\(\)!=64/);
 assert.doesNotMatch(certificate,/tauri::command|invoke_handler/);
});
