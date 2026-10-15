import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read = path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const rust=read("src-tauri/src/blender_artifact_manifest.rs");
const oneShot=read("src-tauri/src/blender_plan_worker.rs");
const session=read("src-tauri/src/blender_session_worker.rs");
const lib=read("src-tauri/src/lib.rs");

test("both approved Blender execution paths expose the same typed handoff",()=>{
  assert.match(lib,/mod blender_artifact_manifest;/);
  assert.match(oneShot,/blender_artifact_manifest::build\(&value,Path::new\(output_dir\),action_id,None\)/);
  assert.match(session,/blender_artifact_manifest::build\(\s*&response,Path::new\(&session\.output_dir\),action_id,Some\(id\)\)/);
  assert.match(oneShot,/"artifact_manifest":manifest/);
  assert.match(session,/"artifact_manifest":manifest/);
  assert.match(rust,/pub\(crate\) fn build\(/);
  assert.match(rust,/verify_output\(output,output_root\)\?/);
});

test("handoff is action-correlated, path/hash verified, and explicitly not an import",()=>{
  for(const guard of [
    "Uuid::parse_str(action_id)",
    "Uuid::parse_str(id)",
    "source_action_id",
    "source_session_id",
    "native_file_sha256_readback",
    "independent_read_only_reopen",
    "requires_new_action_approval",
    "import_performed",
    "target_application",
    "host_live_acceptance_proven",
    "visual_quality_verified",
    "std::fs::symlink_metadata(original)"
  ]) assert.ok(rust.includes(guard),"Missing handoff guard: "+guard);
  assert.match(oneShot,/let action_id=execution_action_id\.ok_or/);
  assert.doesNotMatch(rust,/Command::new|std::process::Command|eval\(/);
});

test("native unit cases cover valid lineage, missing proof, output tamper and denial",()=>{
  for(const caseName of [
    "authentic_handoff_contains_verified_provenance_but_no_import_claim",
    "tampering_on_disk_or_outside_approved_root_is_denied",
    "invalid_lineage_and_missing_reopen_evidence_are_denied",
    "incomplete_or_untrusted_worker_cannot_claim_handoff",
  ])assert.ok(rust.includes("fn "+caseName+"("),caseName);
});
