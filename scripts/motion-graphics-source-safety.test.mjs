import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const motion=readFileSync(new URL("../src-tauri/src/motion_graphics.rs",import.meta.url),"utf8");
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
  assert.match(status,/Image\/frame review is not yet wired/);
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
