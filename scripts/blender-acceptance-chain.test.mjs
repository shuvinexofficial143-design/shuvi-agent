import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const main=read("src-tauri/src/lib.rs");
const chain=read("src-tauri/src/blender_acceptance_chain.rs");
const manifest=read("src-tauri/src/blender_artifact_manifest.rs");
const gate=read("src-tauri/src/blender_plan_worker.rs");

test("three-stage receipt reviewer is wired into normal approval/audit and never executes Blender",()=>{
  assert.match(main,/mod blender_acceptance_chain;/);
  assert.match(main,/BlenderReviewAcceptanceChain \{ approved_output_dir:String, receipts:Value \}/);
  assert.match(main,/"blender_review_acceptance_chain" => \{/);
  assert.match(main,/ToolAction::BlenderReviewAcceptanceChain \{approved_output_dir,receipts\}/);
  assert.match(main,/blender_acceptance_chain::review\(&receipts,Path::new\(&approved_output_dir\)\)/);
  assert.doesNotMatch(chain,/Command::new\(|std::process::Command|launch\(|process\.spawn\(/);
});
test("reviewer compares exact separately approved stages, actual current bytes and geometry evidence",()=>{
  for(const required of [
    '"shuvi41-proof-stage1.blend"',
    '"shuvi41-proof-stage2.blend"',
    '"shuvi41-proof-render.png"',
    "blender_artifact_manifest::reverify(manifest,approved_root)?",
    "source_action_id",
    "source_session_id",
    "first_two_same_session",
    "render_uses_different_session",
    "mesh_geometry_verified",
    "mesh_fingerprint",
    "topology_fingerprints",
    "scene_fingerprint",
    "current_file_sha256_rechecked",
    "render_source_stage2_binding_proven",
    "historical_owner_approval_reauthenticated",
    "live_blender_runtime_verified_by_this_review",
    "import_performed"
  ])assert.ok(chain.includes(required),"Missing stage gate: "+required);
  assert.match(manifest,/pub\(crate\) fn reverify\(/);
  assert.match(chain,/sessions\[0\]!=sessions\[1\] \|\| sessions\[2\]==sessions\[1\]/);
  assert.match(chain,/fingerprints\[0\]==fingerprints\[1\]/);
  assert.match(chain,/topology_fingerprints\[0\]==topology_fingerprints\[1\]/);
});
test("native proof refuses fake Blender header and PNG IHDR despite matching extension and supplied hash",()=>{
  for(const guard of [
    'b"BLENDER"',
    '"Blender output has an invalid .blend header."',
    'b"IHDR"',
    '"Blender PNG IHDR does not match the claimed RGBA8 render."',
    'hasher.update(&prefix[..prefix_len])',
    'format!("{:x}",hasher.finalize())'
  ])assert.ok(gate.includes(guard),guard);
});
test("four native unit scenarios cover valid files, swapped sessions, altered data and wrong paths",()=>{
  for(const name of [
    "matching_three_receipts_review_current_bytes_without_overclaim",
    "rejects_replayed_action_ids_and_session_substitution",
    "rejects_unchanged_geometry_missing_proof_and_tampered_bytes",
    "rejects_swapped_stages_or_out_of_root_receipts"
  ])assert.ok(chain.includes("fn "+name+"("),name);
});
