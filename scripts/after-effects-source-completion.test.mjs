import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const files={
  rust:readFileSync(new URL("../src-tauri/src/after_effects.rs",import.meta.url),"utf8"),
  transport:readFileSync(new URL("../src-tauri/src/after_effects_transport.rs",import.meta.url),"utf8"),
  runtime:readFileSync(new URL("../src-tauri/src/after_effects_runtime.rs",import.meta.url),"utf8"),
  checkpoint:readFileSync(new URL("../src-tauri/src/after_effects_checkpoint.rs",import.meta.url),"utf8"),
  media:readFileSync(new URL("../src-tauri/src/after_effects_media_validation.rs",import.meta.url),"utf8"),
  templates:readFileSync(new URL("../src-tauri/src/after_effects_templates.rs",import.meta.url),"utf8"),
  jsx:readFileSync(new URL("../integrations/after-effects-extendscript/shuvi-ae.jsx",import.meta.url),"utf8"),
  lib:readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8")
};

test("After Effects declared source scope is complete without claiming runtime readiness",()=>{
  assert.match(files.rust,/"source_coding_complete_for_declared_scope":true/);
  assert.match(files.rust,/"source_coding_status":"complete_for_declared_extendscript_scope"/);
  assert.match(files.rust,/"current_transport":\{\s*"kind":"extendscript_afterfx_r",\s*"state":"source_implemented_runtime_unverified"/);
  assert.match(files.rust,/"source_runtime_verified":false/);
  assert.match(files.rust,/"runtime_verified":false/);
  assert.match(files.rust,/"production_ready":false/);
  assert.match(files.rust,/"current_source_revision_bound":false/);
});

test("After Effects completion keeps unavoidable exclusions explicit",()=>{
  for(const token of [
    "native_motion_tracker_control_not_exposed_by_reviewed_scripting_surface",
    "native_hand_detection_not_provided_by_after_effects_scripting",
    "media_byte_stream_decode_requires_separate_decoder_runtime",
    "non_render_inflight_abort_has_no_reviewed_safe_native_route",
    "uxp_transport_reserved_until_after_effects_uxp_is_a_supported_target"
  ]) assert.match(files.rust,new RegExp(token));
  assert.match(files.rust,/"render_media_decode_validation":"intentional_separate_decoder_runtime_boundary"/);
  assert.match(files.rust,/"non_render_mutation_cancellation":\{"state":"unsupported_no_documented_safe_abort"/);
});

test("AE readiness preserves all nine independent evidence dimensions",()=>{
  for(const dimension of ["source_implementation","node_static_tests","windows_after_effects_runtime","extendscript_host_acceptance",
    "mutation_semantics","project_save_persistence","render_completion","media_parse","production_ready"]){
    assert.match(files.rust,new RegExp('"'+dimension+'"\\s*:'));
  }
  assert.match(files.rust,/"media_parse_verified":false/);
  assert.match(files.rust,/"unsaved_host_edits_preserved":false/);
  assert.match(files.rust,/"automatic_execution":false/);
  assert.doesNotMatch(files.rust,/"render_media_parse_validation":"not_implemented"/);
});

test("After Effects complete source retains verification and recovery boundaries",()=>{
  assert.match(files.transport,/expected_project_revision:Option<u64>/);
  assert.match(files.runtime,/after_effects_media_validation::validate/);
  assert.match(files.runtime,/pub fn cancel_render/);
  assert.match(files.checkpoint,/pub fn verify\(backup:&Path,expected_source:&Path\)/);
  assert.match(files.jsx,/verified_render_cancelled/);
  assert.match(files.jsx,/semantic_result_verified:false/);
  assert.match(files.lib,/after_effects_verify_checkpoint/);
  assert.match(files.lib,/after_effects_cancel_render/);
});

test("After Effects source has no unfinished placeholder markers",()=>{
  for(const [name,source] of Object.entries(files)){
    assert.doesNotMatch(source,/\bTODO\b|\bFIXME\b|IMPLEMENT\s+ME|throw new Error\(["']not implemented/i,name+" contains unfinished placeholder");
  }
});
