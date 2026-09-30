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


test("AE motion graphics creation re-resolves indexed groups and stays non-retryable",()=>{
  assert.match(transport,/"add_shape_primitive"/);
  assert.match(transport,/"add_text_animator"/);
  assert.match(rust,/"shape_primitive":"source_supported_rectangle_ellipse_with_fill_stroke_readback"/);
  assert.match(rust,/"text_animator":"source_supported_allowlisted_property_with_range_selector_readback"/);
  assert.match(jsx,/ADBE Root Vectors Group/);
  assert.match(jsx,/ADBE Vector Graphic - Fill/);
  assert.match(jsx,/ADBE Vector Graphic - Stroke/);
  assert.match(jsx,/ADBE Text Animator/);
  assert.match(jsx,/ADBE Text Selector/);
  for(const fn of ["addShapePrimitive","addTextAnimator"]){
    const start=jsx.indexOf("function "+fn+"("),next=jsx.indexOf("\n    function ",start+10);
    assert.notEqual(start,-1);
    assert.match(jsx.slice(start,next<0?jsx.length:next),/retry_safe:false/);
  }
});


test("AE discovery stays read-only and bounded",()=>{
  for(const action of ["inspect_project_items","inspect_effects","inspect_keyframes","inspect_layer_properties"]){
    assert.match(transport,new RegExp('"' + action + '"'));
    assert.match(jsx,new RegExp('action === "' + action + '"'));
  }
  assert.match(rust,/"project_item_inspection":"source_supported_bounded_512_items"/);
  assert.match(rust,/"effect_inspection":"source_supported_bounded_256_effects"/);
  assert.match(rust,/"keyframe_inspection":"source_supported_bounded_512_keys"/);
  assert.match(rust,/"layer_property_tree":"source_supported_depth_6_nodes_1024"/);
  assert.match(jsx,/state\.count>=1024/);
  assert.match(jsx,/depth>=6/);
  assert.match(jsx,/Math\.min\(count,512\)/);
});


test("AE unresolved dispatch survives timeout and blocks blind next run",()=>{
  assert.match(runtime,/static DISPATCH_IO:std::sync::Mutex/);
  assert.match(runtime,/pending_jobs\(workspace,false\)/);
  assert.match(runtime,/earlier After Effects request is unresolved or has an unacknowledged late receipt/);
  assert.match(runtime,/receipt_missing/);
  assert.match(runtime,/receipt_available/);
  assert.match(runtime,/retry_safe":false/);
  assert.match(lib,/- after_effects_pending_jobs: \{\}/);
  assert.match(lib,/AfterEffectsPendingJobs/);
});


test("AE readiness never promotes unexecuted source to production",()=>{
  assert.match(rust,/pub fn readiness_report/);
  assert.match(rust,/"windows_after_effects_runtime":\{"state":"not_verified"/);
  assert.match(rust,/"render_completion":\{"state":"not_verified"/);
  assert.match(rust,/"production_ready":false/);
  assert.match(rust,/"current_source_revision_bound":false/);
  assert.match(lib,/- after_effects_readiness_report: \{\}/);
});


test("AE executable path is restricted to the canonical Adobe install tree",()=>{
  assert.match(runtime,/fn trusted_afterfx_exe/);
  assert.match(runtime,/ProgramFiles/);
  assert.match(runtime,/join\("Adobe"\)/);
  assert.match(runtime,/exe\.starts_with\(&root\)/);
  assert.match(runtime,/Support Files/);
  assert.match(runtime,/Adobe After Effects/);
  assert.match(runtime,/trusted_afterfx_exe\(afterfx_exe\)\?/);
});


test("AE render requires exact queue identity host DONE and desktop output evidence",()=>{
  assert.match(transport,/"render_queue"/);
  assert.match(rust,/"render_queue_execute":"source_supported_exact_queued_set_with_host_done_and_desktop_file_evidence"/);
  assert.match(rust,/"render_media_parse_validation":"not_implemented"/);
  assert.match(jsx,/unlisted render-enabled queue item would also render/);
  assert.match(jsx,/item\.status===RQItemStatus\.DONE/);
  assert.match(jsx,/verified_render_completion/);
  assert.match(runtime,/fn render_output_evidence/);
  assert.match(runtime,/desktop_outputs_verified/);
  assert.match(runtime,/media_parse_verified":false/);
  assert.match(runtime,/verification=="verified_render_completion"&&render_verified/);
});


test("AE relink proxy and AV layer controls require stale guards and readback",()=>{
  for(const action of ["relink_footage","set_proxy","remove_proxy","set_av_layer_flags"]){
    assert.match(transport,new RegExp('"' + action + '"'));
    assert.match(jsx,new RegExp('action === "' + action + '"'));
  }
  assert.match(rust,/"footage_relink":"source_supported_with_exact_old_new_file_readback"/);
  assert.match(rust,/"proxy_set_remove":"source_supported_with_proxy_state_file_readback"/);
  assert.match(rust,/"av_layer_flags":"source_supported_with_boolean_readback"/);
  assert.match(jsx,/Footage source stale guard changed/);
  assert.match(jsx,/Proxy enabled-state stale guard changed/);
  assert.match(jsx,/Proxy source stale guard changed/);
  assert.match(jsx,/Layer is locked; AV flag mutation refused/);
  assert.match(jsx,/verified_proxy_readback/);
  assert.match(jsx,/verified_layer_flag_readback/);
});


test("AE mask edit and removal stay stale-guarded and readback verified",()=>{
  for(const action of ["edit_mask","remove_mask"]){
    assert.match(transport,new RegExp('"' + action + '"'));
    assert.match(jsx,new RegExp('action === "' + action + '"'));
  }
  assert.match(rust,/"mask_edit":"source_supported_with_shape_attribute_readback_and_stale_guards"/);
  assert.match(rust,/"mask_remove":"source_supported_with_ordered_inventory_delta"/);
  assert.match(jsx,/Mask name stale guard changed/);
  assert.match(jsx,/Mask mode stale guard changed/);
  assert.match(jsx,/Mask is locked; unlock explicitly before editing/);
  assert.match(jsx,/sameMaskInventory\(after,expectedAfter\)/);
  assert.match(jsx,/verified_mask_delta/);
});


test("AE spatial keyframe controls stay spatial-only stale-guarded and readback verified",()=>{
  assert.match(transport,/"set_keyframe_spatial"/);
  assert.match(rust,/"keyframe_spatial_controls":"source_supported_two_three_d_spatial_tangents_continuity_auto_bezier_roving_with_time_stale_guard"/);
  assert.match(jsx,/PropertyValueType\.TwoD_SPATIAL/);
  assert.match(jsx,/PropertyValueType\.ThreeD_SPATIAL/);
  assert.match(jsx,/Spatial keyframe time stale guard changed/);
  assert.match(jsx,/setSpatialTangentsAtKey\(index,requestedIn,requestedOut\)/);
  assert.match(jsx,/setSpatialContinuousAtKey\(index,args\.continuous\)/);
  assert.match(jsx,/setSpatialAutoBezierAtKey\(index,args\.auto_bezier\)/);
  assert.match(jsx,/setRovingAtKey\(index,args\.roving\)/);
  assert.match(jsx,/First and last spatial keyframes cannot rove/);
  assert.match(jsx,/verified_spatial_keyframe_readback/);
  assert.match(jsx,/in_spatial_tangent=cloneValue\(p\.keyInSpatialTangent\(i\)\)/);
});


test("AE temporal auto-bezier and continuous flags stay bezier-gated and stale-guarded",()=>{
  assert.match(transport,/"set_keyframe_temporal_flags"/);
  assert.match(rust,/"keyframe_temporal_flags":"source_supported_bezier_gated_auto_bezier_continuous_with_time_stale_guard"/);
  assert.match(jsx,/Temporal keyframe time stale guard changed/);
  assert.match(jsx,/requires BEZIER incoming and outgoing interpolation/);
  assert.match(jsx,/setTemporalContinuousAtKey\(index,args\.continuous\)/);
  assert.match(jsx,/setTemporalAutoBezierAtKey\(index,args\.auto_bezier\)/);
  assert.match(jsx,/verified_temporal_flag_readback/);
  assert.match(jsx,/temporal_auto_bezier=!!p\.keyTemporalAutoBezier\(i\)/);
  assert.match(jsx,/temporal_continuous=!!p\.keyTemporalContinuous\(i\)/);
});


test("AE AV rendering controls are typed allowlisted and independently readable",()=>{
  assert.match(transport,/"inspect_av_layer_rendering"/);
  assert.match(transport,/"set_av_layer_rendering"/);
  assert.match(rust,/"av_layer_rendering":"source_supported_blending_quality_sampling_audio_guide_frame_blending_with_readback"/);
  assert.match(jsx,/BlendingMode\.MULTIPLY/);
  assert.match(jsx,/LayerQuality\.BEST/);
  assert.match(jsx,/LayerSamplingQuality\.BICUBIC/);
  assert.match(jsx,/FrameBlendingType\.PIXEL_MOTION/);
  assert.match(jsx,/Cannot enable audio on a layer without audio/);
  assert.match(jsx,/verified_av_rendering_readback/);
  assert.match(jsx,/function inspectAVLayerRendering/);
});


test("AE mutations bind to documented project revision as a stale-state guard",()=>{
  assert.match(transport,/expected_project_revision:Option<u64>/);
  assert.match(transport,/requires expected_project_revision/);
  assert.match(jsx,/project_revision: project\.revision/);
  assert.match(jsx,/expected_project_revision/);
  assert.match(jsx,/After Effects project revision changed; stale mutation refused/);
  assert.match(rust,/"project_revision":"documented_read_only_revision_stale_guard"/);
  assert.match(rust,/"project_revision_counter":\{"state":"documented_and_required_for_mutation"/);
  assert.match(lib,/expected_project_revision/);
});


test("AE MOGRT authoring uses capability checks controller deltas and exact file evidence",()=>{
  for(const action of ["inspect_mogrt","add_mogrt_property","add_mogrt_media_layer","export_mogrt"]){
    assert.match(transport,new RegExp('"' + action + '"'));
    assert.match(jsx,new RegExp('action === "' + action + '"'));
  }
  assert.match(rust,/"mogrt_property_controller_add":"source_supported_with_controller_inventory_delta"/);
  assert.match(rust,/"mogrt_media_controller_add":"source_supported_with_controller_inventory_delta"/);
  assert.match(rust,/"mogrt_export":"source_supported_host_export_plus_desktop_exact_file_evidence"/);
  assert.match(jsx,/canAddToMotionGraphicsTemplate\(comp\)/);
  assert.match(jsx,/addToMotionGraphicsTemplateAs\(comp,name\)/);
  assert.match(jsx,/stringInventoryAddedOnce\(before,after,name\)/);
  assert.match(jsx,/exportAsMotionGraphicsTemplate\(overwrite,file\.parent\.fsName\)/);
  assert.match(jsx,/desktop_file_verification_required:true/);
});


test("AE MOGRT export requires host and desktop exact file agreement",()=>{
  assert.match(runtime,/fn mogrt_output_evidence/);
  assert.match(runtime,/desktop_mogrt_verified/);
  assert.match(runtime,/verification=="verified_mogrt_file_readback"&&mogrt_verified/);
  assert.match(runtime,/"mogrt_output_evidence":mogrt_evidence/);
  assert.match(jsx,/decodeURI\(String\(file\.name\)\)/);
  assert.match(jsx,/MOGRT output_file must be absolute/);
  assert.match(jsx,/MOGRT output already exists; explicit overwrite=true required/);
});


test("AE hand-track rig only applies grounded samples and never claims native detection",()=>{
  assert.match(transport,/"apply_hand_track_rig"/);
  assert.match(rust,/"hand_track_rig":"source_supported_grounded_samples_to_null_position_keyframes_with_optional_parent_readback"/);
  assert.match(jsx,/validateGroundedTrackSamples/);
  assert.match(jsx,/coordinate_space=comp_pixels/);
  assert.match(jsx,/position\.setValuesAtTimes\(track\.times,track\.values\)/);
  assert.match(jsx,/target\.parent=nullLayer/);
  assert.match(jsx,/target\.setParentWithJump\(nullLayer\)/);
  assert.match(jsx,/verified_hand_track_rig_readback/);
  assert.match(jsx,/native_hand_detection_claimed:false/);
  const start=jsx.indexOf("function applyHandTrackRig("),next=jsx.indexOf("\n    function ",start+10);
  assert.notEqual(start,-1);
  assert.match(jsx.slice(start,next<0?jsx.length:next),/retry_safe:false/);
});


test("AE Essential Properties are bounded stale-guarded and media-compatible",()=>{
  for(const action of ["inspect_essential_properties","set_essential_property","set_essential_media_source"]){
    assert.match(transport,new RegExp('"' + action + '"'));
    assert.match(jsx,new RegExp('action === "' + action + '"'));
  }
  assert.match(rust,/"essential_property_inspection":"source_supported_bounded_256_with_source_and_alternate_media_identity"/);
  assert.match(rust,/"essential_property_static_write":"source_supported_non_media_unkeyed_with_name_stale_guard_and_readback"/);
  assert.match(rust,/"essential_media_replacement":"source_supported_compatible_item_with_current_alternate_stale_guard_and_readback"/);
  assert.match(jsx,/ADBE Layer Overrides/);
  assert.match(jsx,/group\.numProperties>256/);
  assert.match(jsx,/Essential Property name stale guard changed/);
  assert.match(jsx,/Static Essential Property write refused because keyframes already exist/);
  assert.match(jsx,/expected_alternate_source_item_id stale guard/);
  assert.match(jsx,/isMediaReplacementCompatible!==true/);
  assert.match(jsx,/setAlternateSource\(source\)/);
  assert.match(jsx,/verified_essential_media_readback/);
});


test("AE project panel organization stays exact stale-guarded and blocks recursive deletion",()=>{
  for(const action of ["create_project_folder","set_project_item_state","remove_project_item"]){
    assert.match(transport,new RegExp('"' + action + '"'));
    assert.match(jsx,new RegExp('action === "' + action + '"'));
  }
  assert.match(rust,/"project_folder_create":"source_supported_with_parent_and_count_readback"/);
  assert.match(rust,/"project_item_state":"source_supported_name_label_parent_with_stale_guards_and_readback"/);
  assert.match(rust,/"project_item_remove":"source_supported_nonempty_folder_blocked_with_identity_and_count_delta"/);
  assert.match(jsx,/Project item name stale guard changed/);
  assert.match(jsx,/Project item parent folder stale guard changed/);
  assert.match(jsx,/Project folder move would create a parent cycle/);
  assert.match(jsx,/Non-empty project folders cannot be removed automatically/);
  assert.match(jsx,/project\.itemByID\(id\)===null/);
});
