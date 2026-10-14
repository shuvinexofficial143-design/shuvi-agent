import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

// A01 immutable-invariant snapshot of native command and module declarations
// from the separately reviewed main and ui-dashboard branches on 2026-10-09.
// This test proves preservation of registered names; it DOES NOT prove
// merged runtime behavior or permit production deployment.
const native=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const mainHandlers=[
  "list_providers",
  "save_api_key",
  "delete_api_key",
  "save_frame_io_access_token",
  "delete_frame_io_access_token",
  "save_frame_io_oauth_config",
  "delete_frame_io_oauth_config",
  "frame_io_credential_status",
  "chat",
  "runtime_status",
  "prepare_tool",
  "prepare_powershell",
  "deny_action",
  "cancel_running_action",
  "execute_action",
  "execute_powershell",
  "audit_log",
  "action_audit_receipt",
  "record_agent_event",
  "set_workspace",
  "get_workspace",
  "save_session_checkpoint",
  "load_session_checkpoint",
  "clear_session_checkpoint",
  "premiere_bridge_start",
  "premiere_bridge_status",
  "premiere_bridge_stop",
  "audition_bridge_start",
  "audition_bridge_status",
  "audition_bridge_stop",
  "animate_bridge_start",
  "animate_bridge_status",
  "animate_bridge_stop",
  "illustrator_bridge_start",
  "illustrator_bridge_status",
  "illustrator_bridge_stop",
  "photoshop_bridge_start",
  "photoshop_bridge_status",
  "photoshop_bridge_stop",
  "export_diagnostics"
];
const uiHandlers=[
  "list_providers",
  "save_api_key",
  "delete_api_key",
  "chat",
  "runtime_status",
  "prepare_tool",
  "prepare_powershell",
  "deny_action",
  "cancel_running_action",
  "execute_action",
  "execute_powershell",
  "audit_log",
  "action_audit_receipt",
  "record_agent_event",
  "set_workspace",
  "get_workspace",
  "save_session_checkpoint",
  "load_session_checkpoint",
  "clear_session_checkpoint",
  "premiere_bridge_start",
  "premiere_bridge_status",
  "premiere_bridge_stop",
  "audition_bridge_start",
  "audition_bridge_status",
  "audition_bridge_stop",
  "export_diagnostics",
  "web_bridge::web_bridge_start",
  "web_bridge::web_bridge_stop",
  "web_bridge::web_bridge_state"
];
const mainModules=[
  "premiere_execution",
  "premiere_store",
  "after_effects",
  "after_effects_transport",
  "after_effects_checkpoint",
  "after_effects_project_persistence",
  "after_effects_media_validation",
  "after_effects_runtime",
  "after_effects_templates",
  "after_effects_acceptance",
  "premiere_diagnostics",
  "premiere_review",
  "premiere_editorial",
  "premiere_export",
  "media_encoder",
  "premiere_acceptance",
  "premiere_acceptance_harness",
  "premiere_acceptance_execution",
  "premiere_calibration",
  "premiere_export_jobs",
  "premiere_project_persistence",
  "premiere_review_binding",
  "premiere_edit_session",
  "premiere_edit_job",
  "premiere_subtitles",
  "premiere_dialogue",
  "premiere_talking_head",
  "premiere_transcript_rebuild",
  "premiere_scene_detection",
  "premiere_scene_rough_cut",
  "premiere_layering",
  "premiere_media_prep",
  "premiere_delivery",
  "premiere_finishing",
  "premiere_assembly",
  "premiere_mogrt",
  "premiere_graphics",
  "premiere_audio",
  "premiere_recipes",
  "premiere_effects",
  "premiere_target",
  "premiere_keyframes",
  "premiere_checkpoint",
  "premiere_speed",
  "premiere_bridge_queue",
  "premiere_bridge",
  "audition",
  "audition_acceptance",
  "animate",
  "animate_checkpoint",
  "character_animator",
  "substance_3d",
  "frame_io",
  "illustrator",
  "illustrator_checkpoint",
  "illustrator_bridge_queue",
  "illustrator_bridge",
  "photoshop",
  "photoshop_checkpoint",
  "motion_graphics",
  "motion_graphics_provider",
  "motion_graphics_review",
  "motion_graphics_correction",
  "motion_graphics_correction_session",
  "motion_graphics_delivery",
  "motion_graphics_remotion",
  "motion_graphics_remotion_runtime",
  "audition_bridge_queue",
  "audition_bridge",
  "animate_bridge_queue",
  "animate_bridge",
  "photoshop_bridge_queue",
  "photoshop_bridge"
];
const uiModules=[
  "web_bridge",
  "premiere_execution",
  "premiere_store",
  "after_effects",
  "after_effects_transport",
  "after_effects_checkpoint",
  "after_effects_project_persistence",
  "after_effects_media_validation",
  "after_effects_runtime",
  "after_effects_templates",
  "after_effects_acceptance",
  "premiere_diagnostics",
  "premiere_review",
  "premiere_editorial",
  "premiere_export",
  "media_encoder",
  "premiere_acceptance",
  "premiere_acceptance_harness",
  "premiere_acceptance_execution",
  "premiere_calibration",
  "premiere_export_jobs",
  "premiere_project_persistence",
  "premiere_review_binding",
  "premiere_edit_session",
  "premiere_edit_job",
  "premiere_subtitles",
  "premiere_dialogue",
  "premiere_talking_head",
  "premiere_transcript_rebuild",
  "premiere_scene_detection",
  "premiere_scene_rough_cut",
  "premiere_layering",
  "premiere_media_prep",
  "premiere_delivery",
  "premiere_finishing",
  "premiere_assembly",
  "premiere_mogrt",
  "premiere_graphics",
  "premiere_audio",
  "premiere_recipes",
  "premiere_effects",
  "premiere_target",
  "premiere_keyframes",
  "premiere_checkpoint",
  "premiere_speed",
  "premiere_bridge_queue",
  "premiere_bridge",
  "audition",
  "audition_acceptance",
  "motion_graphics",
  "motion_graphics_provider",
  "motion_graphics_review",
  "motion_graphics_correction",
  "motion_graphics_correction_session",
  "motion_graphics_delivery",
  "motion_graphics_remotion",
  "motion_graphics_remotion_runtime",
  "audition_bridge_queue",
  "audition_bridge"
];
const allow=(raw)=>raw.split(",").map(value=>value.trim()).filter(Boolean);
const handlerMatch=native.match(/\.invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/);
const liveHandlers=handlerMatch?allow(handlerMatch[1]):[];
const liveModules=[...native.matchAll(/^mod ([a-z0-9_]+);/gm)].map(x=>x[1]);
test("A01 combined Shuvi retains every exact main and UI native command",()=>{
 assert.ok(handlerMatch,"native Tauri invoke handler registry is missing");
 for(const name of new Set([...mainHandlers,...uiHandlers])){
   assert.ok(liveHandlers.includes(name),"missing native command: "+name);
 }
 assert.equal(new Set(liveHandlers).size,liveHandlers.length,"registered duplicate Tauri command");
 assert.ok(liveHandlers.includes("web_bridge::web_bridge_start"));
 assert.ok(liveHandlers.includes("web_bridge::web_bridge_stop"));
 assert.ok(liveHandlers.includes("web_bridge::web_bridge_state"));
});
test("A01 combined native source retains all original Adobe modules AND the local web bridge",()=>{
 for(const name of new Set([...mainModules,...uiModules])){
   assert.ok(liveModules.includes(name),"missing native module from main or UI baseline: "+name);
 }
 assert.ok(liveModules.includes("web_bridge"),"UI's local read-only bridge was lost");
 assert.equal(new Set(liveModules).size,liveModules.length,"duplicated native module declaration");
});
test("A01 critical lifecycle actions stay registered through reviewed Rust execution gate",()=>{
 assert.ok(liveHandlers.includes("prepare_tool"));
 assert.ok(liveHandlers.includes("cancel_running_action"));
 assert.ok(liveHandlers.includes("execute_action"));
 assert.ok(liveHandlers.includes("execute_powershell"));
 assert.match(native,/execution_lease::claim_single_execution\(&state.native_execution_owned\)\?/);
 for(const product of ["premiere","audition","animate","illustrator","photoshop"]){
   for(const action of ["start","status","stop"]){
     assert.ok(liveHandlers.includes(product+"_bridge_"+action),product+" bridge "+action+" missing");
   }
 }
});
