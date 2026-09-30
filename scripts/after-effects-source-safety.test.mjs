import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/after_effects.rs",import.meta.url),"utf8");
const transport=readFileSync(new URL("../src-tauri/src/after_effects_transport.rs",import.meta.url),"utf8");
const jsx=readFileSync(new URL("../integrations/after-effects-extendscript/shuvi-ae.jsx",import.meta.url),"utf8");
const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const runtime=readFileSync(new URL("../src-tauri/src/after_effects_runtime.rs",import.meta.url),"utf8");
const persistence=readFileSync(new URL("../src-tauri/src/after_effects_project_persistence.rs",import.meta.url),"utf8");
const tauri=readFileSync(new URL("../src-tauri/tauri.conf.json",import.meta.url),"utf8");

test("After Effects source never claims runtime verification",()=>{
  assert.match(rust,/"source_runtime_verified":false/);
  assert.match(rust,/"runtime_verified":"not_verified"/);
  assert.match(rust,/"native_motion_tracker_control":"unsupported_documented_surface"/);
  assert.match(lib,/"runtime_verified":false/);
});

test("AE mutations require exact saved project identity",()=>{
  assert.match(jsx,/Mutating After Effects action requires exact expected_project_file/);
  assert.match(jsx,/Active After Effects project file changed; mutation refused/);
  assert.match(transport,/expected_project_file:Option<String>/);
  assert.match(transport,/validate_project_path/);
});

test("AE targeting uses persistent item and layer IDs plus property matchName guards",()=>{
  assert.match(jsx,/project\.itemByID\(compId\)/);
  assert.match(jsx,/layer\.id === layerId/);
  assert.match(jsx,/next\.matchName !== matchName/);
  assert.match(jsx,/next\.propertyIndex !== segment\.property_index/);
});

test("hand tracking is external grounded samples applied through verified keyframe readback",()=>{
  assert.match(rust,/HandTrackPlan/);
  assert.match(rust,/native_tracker_result_claimed":false/);
  assert.match(jsx,/p\.setValuesAtTimes\(times, values\)/);
  assert.match(jsx,/p\.valueAtTime\(times\[i\], true\)/);
  assert.match(jsx,/verified_keyframe_readback/);
});

test("effect and render queue creation require observable deltas",()=>{
  assert.match(jsx,/afterCount === beforeCount \+ 1/);
  assert.match(jsx,/readback\.matchName === matchName/);
  assert.match(jsx,/after === before \+ 1/);
  assert.match(jsx,/render_completion_verified: false/);
});

test("transport binds request identity and rejects blind runtime trust",()=>{
  assert.match(transport,/request\.request_id!==expectedRequestId/);
  assert.match(transport,/Malformed After Effects receipt JSON/);
  assert.match(transport,/runtime_verified:false/);
  assert.match(transport,/afterfx_arguments:vec!\["-r"/);
});


test("AE media and animation actions stay typed and source-verified",()=>{
  for(const action of ["create_comp","import_footage","add_item_layer","set_text_style","set_keyframe_interpolation","remove_keyframe"]){
    assert.match(transport,new RegExp('"' + action + '"'));
    assert.match(jsx,new RegExp('action === "' + action + '"'));
  }
  assert.match(rust,/"composition_create":"source_supported_with_creation_settings_readback"/);
  assert.match(rust,/"footage_import":"source_supported_footage_only_with_file_identity_readback"/);
  assert.match(rust,/"text_document_style":"source_supported_with_requested_field_readback"/);
  assert.match(rust,/"keyframe_interpolation":"source_supported_with_in_out_type_readback"/);
  assert.match(rust,/"keyframe_remove":"source_supported_with_time_stale_guard_and_delta_readback"/);
  assert.match(jsx,/setInterpolationTypeAtKey/);
  assert.match(jsx,/Keyframe time stale guard changed/);
});

test("non-idempotent AE creation workflows do not advertise automatic retry safety",()=>{
  for(const fn of ["addEffect","addNull","addText","addShape","addSolid","addCamera","addLight","createComp","importFootage","addItemLayer","duplicateLayer","precomposeLayers","addMask","addRenderQueueItem"]){
    const start=jsx.indexOf("function " + fn + "(");
    assert.notEqual(start,-1,fn + " missing");
    const next=jsx.indexOf("\n    function ",start+10);
    const body=jsx.slice(start,next<0?jsx.length:next);
    assert.match(body,/retry_safe:\s*false/,fn + " must remain non-retryable automatically");
  }
});


test("AE temporal easing and timing require exact host readback",()=>{
  assert.match(transport,/"set_keyframe_temporal_ease"/);
  assert.match(transport,/"set_layer_timing"/);
  assert.match(rust,/"keyframe_temporal_ease":"source_supported_with_dimension_bound_speed_influence_readback"/);
  assert.match(rust,/"layer_timing":"source_supported_with_start_in_out_stretch_readback"/);
  assert.match(jsx,/new KeyframeEase\(item\.speed,item\.influence\)/);
  assert.match(jsx,/setTemporalEaseAtKey\(index,inEase,outEase\)/);
  assert.match(jsx,/keyInTemporalEase\(index\)/);
  assert.match(jsx,/keyOutTemporalEase\(index\)/);
  assert.match(jsx,/Layer out_point must remain greater than in_point/);
  assert.match(jsx,/verified_timing_readback/);
});


test("AE runtime preserves host-declared retry safety",()=>{
  assert.match(runtime,/host_retry_safe=receipt\.result\.as_ref\(\)/);
  assert.match(runtime,/receipt\.ok&&post_verified&&host_retry_safe/);
  assert.match(runtime,/"host_retry_safe":host_retry_safe/);
  assert.match(runtime,/"execution_status_unknown"/);
  assert.match(runtime,/"retry_safe":false/);
});


test("AE effect removal and markers use bounded stale-guarded deltas",()=>{
  for(const action of ["remove_effect","inspect_markers","add_marker","remove_marker"]) {
    assert.match(transport,new RegExp('"' + action + '"'));
    assert.match(jsx,new RegExp('action === "' + action + '"'));
  }
  assert.match(rust,/"effect_remove":"source_supported_with_ordered_inventory_delta"/);
  assert.match(rust,/"marker_add":"source_supported_with_time_value_delta_readback"/);
  assert.match(rust,/"marker_remove":"source_supported_with_time_comment_stale_guard"/);
  assert.match(jsx,/Effect stale guard changed/);
  assert.match(jsx,/sameEffectInventory\(after,expectedAfter\)/);
  assert.match(jsx,/Marker time stale guard changed/);
  assert.match(jsx,/Marker comment stale guard changed/);
  assert.match(jsx,/Marker already exists at requested time/);
});


test("AE project save requires independent disk persistence evidence",()=>{
  assert.match(rust,/"project_save_persistence":"source_supported_with_independent_file_fingerprint"/);
  assert.match(runtime,/save_before=if request\.action=="save_project"/);
  assert.match(runtime,/after_effects_project_persistence::assess/);
  assert.match(runtime,/verification="verified_file_persistence"/);
  assert.match(persistence,/content_fingerprint_changed/);
  assert.match(persistence,/"edit_semantics_verified":false/);
  assert.match(persistence,/"retry_safe":false/);
});


test("AE execution cannot substitute an arbitrary JSX adapter",()=>{
  assert.match(tauri,/"\.\.\/integrations\/after-effects-extendscript\/shuvi-ae\.jsx"\s*:\s*"after-effects\/shuvi-ae\.jsx"/);
  assert.doesNotMatch(lib,/arg_string\(&proposal\.arguments,"core_script"\)/);
  assert.doesNotMatch(lib,/AfterEffectsRun \{ afterfx_exe:String, core_script:String/);
  assert.match(lib,/resource_dir\(\)/);
  assert.match(lib,/join\("after-effects"\)\.join\("shuvi-ae\.jsx"\)/);
});
