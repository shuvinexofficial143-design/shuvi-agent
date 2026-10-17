import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=n=>readFileSync(new URL("../src-tauri/src/"+n,import.meta.url),"utf8");
const ledger=read("native_resource_lanes.rs");
const plan=read("native_blender_owned_plan.rs");
const status=read("native_worker_status.rs");
test("approved full plan SHA-256 is durably held before owned native Blender execution",()=>{
 assert.ok(plan.includes("reserve_blender_plan(\n        app,action_id,blend_file,output_dir,&expected_plan_sha256)?;"));
 assert.ok(ledger.includes("approved_plan_sha256:Option<String>"));
 assert.ok(ledger.includes("reserve_plan_at(&path(app)?,action,resources,Some(approved_plan_sha256))"));
 assert.ok(ledger.includes("valid_sha256(digest)"));
 assert.ok(ledger.includes("approved_plan_hash_is_reserved_before_worker_and_survives_restart"));
 assert.ok(ledger.includes("invalid_digest_fails_before_persist_and_legacy_record_does_not_gain_provenance"));
});
test("resource claim refuses release on wrong artifact plan or unbound output",()=>{
 assert.ok(ledger.includes("certificate_plan_sha256!=Some(expected)"));
 assert.ok(ledger.includes("read_verified(app,action)"));
 assert.ok(ledger.includes("release_at(&file,action,&cert.path,cert.plan_sha256.as_deref())"));
 assert.ok(ledger.includes("approved_plan_sha256:claim.approved_plan_sha256.clone()"));
 assert.ok(status.includes("pub resource_claims:Vec"));
});
