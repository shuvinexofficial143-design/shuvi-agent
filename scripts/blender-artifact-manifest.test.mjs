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

test("read-only downstream tool re-hashes bytes without trusting historical approval",()=>{
  assert.match(lib,/BlenderVerifyArtifactManifest/);
  assert.match(lib,/"blender_verify_artifact_manifest" => \{/);
  assert.match(lib,/blender_artifact_manifest::reverify\(&manifest,Path::new\(&approved_output_dir\)\)/);
  assert.match(rust,/pub\(crate\) fn reverify\(/);
  assert.match(rust,/verify_output\(&receipt,approved_root\)\?/);
  for(const guard of [
    '"current_file_integrity_verified":true',
    '"source_action_approval_reverified":false',
    '"original_blender_reopen_reexecuted":false',
    '"import_performed":false',
    '"requires_new_action_approval":true'
  ])assert.ok(rust.includes(guard),guard);
});

test("native unit cases cover valid lineage, missing proof, output tamper and denial",()=>{
  for(const caseName of [
    "authentic_handoff_contains_verified_provenance_but_no_import_claim",
    "tampering_on_disk_or_outside_approved_root_is_denied",
    "invalid_lineage_and_missing_reopen_evidence_are_denied",
    "incomplete_or_untrusted_worker_cannot_claim_handoff",
    "downstream_rechecks_actual_bytes_but_never_promotes_prior_approval",
    "downstream_rejects_changed_bytes_wrong_root_and_forged_lineage",
  ])assert.ok(rust.includes("fn "+caseName+"("),caseName);
});

test("materialized render delivery includes source-SHA-bound preflight, but reverify does not invent fresh source or shader attestation",()=>{
  assert.ok(rust.includes('fn material_source_evidence('));
  assert.ok(rust.includes("crate::blender_input_checkpoint::inspect(Some(source),Some(digest))?"));
  assert.ok(rust.includes('"material_render_source":material'));
  assert.ok(rust.includes('fn validate_historical_material_proof('));
  assert.ok(rust.includes("material_source_preflight_reexecuted"));
  assert.ok(rust.includes('"material_source_current_bytes_reverified":false'));
  assert.ok(rust.includes('"shader_parameters_independently_verified":true'));
  for(const caseName of [
    "native_material_delivery_binds_real_source_sha_camera_light_and_session",
    "historical_material_evidence_is_non_authoritative_and_fail_closed"
  ])assert.ok(rust.includes("fn "+caseName+"("));
});

test("saved optional copper .blend requires independently reopened slot and camera/light evidence in native handoff",()=>{
  for(const token of [
    "let material_look= saved",
    'proof.and_then(|p|p.get("proof_copper_material_verified"))',
    '"material_look_checkpoint_verified":material_look',
    '"proof_copper_material_verified":if material_look {Value::Bool(true)}else{Value::Null}',
    '"shader_parameters_independently_verified":if material_look {Value::Bool(true)}else{Value::Null}',
    '"material_look_reopened_again_by_this_review":false',
    "copper_look_handoff_requires_independent_reopened_material_camera_and_light",
    "stage2_checkpoint_is_not_mistaken_for_optional_look_proof"
  ])assert.ok(rust.includes(token),token);
});

test("material-render preflight historical provenance includes independently authenticated shader graph revision",()=>{
  for(const p of [
    '"shader_graph_revision":shader_rev',
    '"shader_node_graph_revision_verified":true',
    'let shader=proof.get("shader_graph_revision")',
    '||proof.get("shader_parameters_independently_verified").and_then(Value::as_bool)!=Some(true)'
  ])assert.ok(rust.includes(p),p);
});

test("saved copper .blend independently reopens Principled shader graph, not just material slot",()=>{
  for(const token of [
    '"proof_copper_shader_revision":if material_look',
    'proof.and_then(|p|p.get("proof_copper_shader_revision"))',
    'evidence.get("proof_copper_shader_revision")',
    '("proof_copper_shader_revision",json!("invalid"))'
  ])assert.ok(rust.includes(token),token);
  assert.ok(oneShot.includes('proof.get("proof_copper_shader_revision")'));
});

test("BLEND handoff preserves and cross-checks bytes-stable reopen SHA against current on-disk native proof",()=>{
  for(const t of [
    '"checkpoint_bytes_stable_during_reopen":saved',
    '"checkpoint_file_sha256":if saved',
    'evidence.get("checkpoint_file_sha256").and_then(Value::as_str)!=Some(hash)',
    '"checkpoint_file_sha256":evidence["checkpoint_file_sha256"]'
  ])assert.ok(rust.includes(t),t);
});
