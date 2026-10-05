import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const motion=readFileSync(new URL("../src-tauri/src/motion_graphics.rs",import.meta.url),"utf8");
const provider=readFileSync(new URL("../src-tauri/src/motion_graphics_provider.rs",import.meta.url),"utf8");
const review=readFileSync(new URL("../src-tauri/src/motion_graphics_review.rs",import.meta.url),"utf8");
const correction=readFileSync(new URL("../src-tauri/src/motion_graphics_correction.rs",import.meta.url),"utf8");
const status=readFileSync(new URL("../docs/MOTION_GRAPHICS_STATUS.md",import.meta.url),"utf8");

test("motion graphics keeps a renderer-neutral bounded schema",()=>{
  for(const token of ["Renderer","AfterEffects","Remotion","DeliveryKind","TransparentOverlay","LayerKind","Property","Easing"]){
    assert.match(motion,new RegExp(token));
  }
  assert.match(motion,/MAX_SCENES:usize=64/);
  assert.match(motion,/MAX_LAYERS_PER_SCENE:usize=128/);
  assert.match(motion,/MAX_KEYFRAMES_PER_TRACK:usize=96/);
  assert.match(motion,/keyframe times must be strictly increasing/);
  assert.match(motion,/Transparent overlay delivery requires transparent_background=true/);
});

test("motion graphics validation tool is read only",()=>{
  assert.match(rust,/motion_graphics_validate_plan/);
  assert.match(rust,/MotionGraphicsValidatePlan/);
  assert.match(rust,/plan\.validate\(\)\?/);
  assert.match(rust,/plan\.summary\(\)\?/);
  assert.match(motion,/renderer_execution_performed":false/);
  assert.match(motion,/preview_render_verified":false/);
  assert.match(motion,/visual_review_verified":false/);
  assert.match(motion,/production_ready":false/);
  assert.doesNotMatch(motion,/Command::new/);
});

test("Anthropic provider remains explicit and current-model configured",()=>{
  assert.match(rust,/id: "anthropic"/);
  assert.match(rust,/default_model: "claude-sonnet-5-5"/);
  assert.match(rust,/https:\/\/api\.anthropic\.com\/v1\/messages/);
  assert.match(rust,/anthropic-version/);
});

test("motion graphics docs do not overclaim renderer or visual review readiness",()=>{
  assert.match(status,/Source runtime verification: \*\*not verified\*\*/);
  assert.match(status,/Production ready: \*\*false\*\*/);
  assert.match(status,/No renderer is launched/);
  assert.match(status,/single-frame image review is now wired/);
  assert.match(status,/does not prove that After Effects\/Remotion produced it/);
  assert.match(status,/persistent multi-iteration correction session is not yet implemented/);
});


test("After Effects adapter plan stays staged and guarded",()=>{
  assert.match(rust,/motion_graphics_plan_after_effects/);
  assert.match(rust,/MotionGraphicsPlanAfterEffects/);
  assert.match(motion,/AfterEffectsPlanRequest/);
  assert.match(motion,/automatic_execution":false/);
  assert.match(motion,/host_mutation_performed":false/);
  assert.match(motion,/requires_fresh_project_revision":true/);
  assert.match(motion,/requires_unique_request_id":true/);
  assert.match(motion,/\$verified_receipt/);
  assert.match(motion,/vector_transform_readback_required/);
  assert.match(motion,/missing_inspected_asset_item_id/);
  assert.match(motion,/shape_visual_spec_missing/);
  assert.match(motion,/transparent_render_output_not_planned/);
  assert.match(motion,/directional_easing_needs_temporal_ease_synthesis/);
});


test("provider-generated motion plans are strict and fail closed",()=>{
  assert.match(rust,/motion_graphics_generate_plan/);
  assert.match(rust,/MotionGraphicsGeneratePlan/);
  assert.match(rust,/motion_graphics_provider::system_prompt/);
  assert.match(rust,/send_chat\(/);
  assert.match(rust,/response\.tool_proposal\.is_some\(\)/);
  assert.match(rust,/request\.parse_generated\(&response\.content\)\?/);
  assert.match(rust,/strict_json_validated":true/);
  assert.match(rust,/fixed_constraints_preserved":true/);
  assert.match(provider,/raw JSON only/);
  assert.match(provider,/Generated motion-graphics plan changed the fixed objective/);
  assert.match(provider,/invented unavailable asset_id/);
  assert.match(provider,/Provider-generated shape layers are disabled/);
  assert.match(provider,/must return raw JSON without markdown fences/);
  assert.match(provider,/MAX_PROVIDER_PLAN_BYTES:usize=256\*1024/);
  assert.doesNotMatch(provider,/Command::new/);
});


test("motion preview review sends only approved bytes and never auto-fixes",()=>{
  assert.match(rust,/motion_graphics_review_preview/);
  assert.match(rust,/MotionGraphicsReviewPreview/);
  assert.match(rust,/preview_bytes: Vec<u8>/);
  assert.match(rust,/read_file_bytes_bounded\(path,8\*1024\*1024,"motion preview PNG"\)/);
  assert.match(rust,/analyze_png_bytes_with_provider\(&provider,&prompt,&preview_bytes\)\.await\?/);
  assert.match(rust,/preview_bytes_bound_at_approval":true/);
  assert.match(rust,/renderer_provenance_verified":false/);
  assert.match(rust,/automatic_correction_performed":false/);
  assert.match(review,/Judge only what is visibly supported by this frame/);
  assert.match(review,/must return raw JSON without markdown fences/);
  assert.match(review,/used a criterion outside the plan allowlist/);
  assert.match(review,/invented unknown layer id/);
  assert.match(review,/A passing motion visual review must not contain issues/);
  assert.doesNotMatch(review,/Command::new/);
});


test("motion correction stays snapshot-bound and proposal-only",()=>{
  assert.match(rust,/motion_graphics_generate_correction/);
  assert.match(rust,/MotionGraphicsGenerateCorrection/);
  assert.match(rust,/motion_graphics_correction::system_prompt/);
  assert.match(rust,/request\.parse_revision\(&response\.content\)\?/);
  assert.match(rust,/snapshot_match_verified":true/);
  assert.match(rust,/immutable_topology_preserved":true/);
  assert.match(rust,/automatic_correction_performed":false/);
  assert.match(motion,/pub fn fingerprint\(&self\)/);
  assert.match(motion,/fnv1a64:/);
  assert.match(correction,/plan_snapshot does not match the exact supplied plan/);
  assert.match(correction,/MAX_CORRECTION_ITERATIONS:u8=3/);
  assert.match(correction,/MAX_CORRECTION_CONTEXT_BYTES:usize=384\*1024/);
  assert.match(correction,/You may change only layer animation tracks/);
  assert.match(correction,/changed immutable layer identity\/content/);
  assert.match(correction,/returned the unchanged plan/);
  assert.match(review,/MAX_REVIEW_ACTIVE_LAYERS:usize=512/);
  assert.doesNotMatch(correction,/Command::new/);
});
