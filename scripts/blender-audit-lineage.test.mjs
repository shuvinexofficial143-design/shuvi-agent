import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=(name)=>readFileSync(new URL("../"+name,import.meta.url),"utf8");
const lib=read("src-tauri/src/lib.rs");
const audit=read("src-tauri/src/blender_action_audit.rs");
const chain=read("src-tauri/src/blender_acceptance_chain.rs");

test("approved Blender action stores exact source/output lineage in a durable native audit",()=>{
  assert.match(lib,/mod blender_action_audit;/);
  assert.match(lib,/"blender_session_plan"\|"blender_run_plan"=>\s*blender_action_audit::append\(base,&value\)/);
  assert.match(audit,/pub\(crate\) fn suffix\(receipt:&Value\)/);
  for(const needle of [
    "blender_action_receipt_v1",
    "blender_output_sha256",
    "blender_output_path_sha256",
    "blender_output_bytes",
    "blender_session_id",
    "blender_input_sha256",
    "blender_input_path_sha256",
    "blender_input_bytes",
    "blender_mesh_fingerprint",
    "blender_scene_fingerprint",
    "mesh_geometry_verified",
    "source_action_id",
    "source_session_id"
  ]) assert.ok(audit.includes(needle),needle);
  assert.match(audit,/detail\.ends_with\(&expected\)/);
});

test("three-stage reviewer requires all three successful native audit UUIDs",()=>{
  const begin=lib.indexOf("ToolAction::BlenderReviewAcceptanceChain {approved_output_dir,receipts} => {");
  const end=lib.indexOf("ToolAction::BlenderVerifyArtifactManifest",begin);
  assert.ok(begin>0 && end>begin);
  const branch=lib.slice(begin,end);
  assert.match(branch,/read_action_audit_receipt\(app,id\)\?/);
  assert.match(branch,/evidence\.event!="executed"/);
  assert.match(branch,/!evidence\.success/);
  assert.match(branch,/evidence\.tool!="blender_session_plan"/);
  assert.match(branch,/evidence\.action_id\.as_deref\(\)!=Some\(id\)/);
  assert.match(branch,/blender_action_audit::verify_detail\(&evidence\.detail,receipt\)/);
  assert.match(branch,/historical_owner_approval_reauthenticated"\]=json!\(true\)/);
  assert.match(branch,/local_audit_cryptographically_tamper_proof"\]=json!\(false\)/);
  assert.match(branch,/live_blender_runtime_verified_by_this_review"\]=json!\(false\)/);
});

test("pure on-disk review stays explicitly nonauthoritative without native audit",()=>{
  assert.match(chain,/"historical_owner_approval_reauthenticated":false/);
  assert.match(chain,/"render_source_stage2_binding_proven":false/);
  assert.doesNotMatch(audit,/Command::new|std::process::Command|subprocess|launch\(/);
});

test("native unit suite rejects replaced output hash, wrong session, altered input source and forged audit details",()=>{
  for(const unit of [
    "exact_audit_suffix_binds_success_to_output_and_session",
    "suffix_must_be_exact_end_not_substring_of_preparation",
    "input_path_hash_byte_length_and_digest_are_bound",
    "forged_malformed_receipts_are_denied"
  ]) assert.ok(audit.includes("fn "+unit+"("),unit);
});
