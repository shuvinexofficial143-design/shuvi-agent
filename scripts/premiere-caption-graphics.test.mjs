import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const planner=readFileSync("src-tauri/src/premiere_caption_graphics.rs","utf8");
const captions=readFileSync("src-tauri/src/premiere_selective_captions.rs","utf8");
const graphics=readFileSync("src-tauri/src/premiere_graphics.rs","utf8");
const host=readFileSync("integrations/premiere-uxp/main.js","utf8");
const desktop=readFileSync("src-tauri/src/lib.rs","utf8");
const slice=(a,b)=>{
  const start=desktop.indexOf(a),end=desktop.indexOf(b,start);
  assert.ok(start>=0&&end>start,"Missing exact Rust route "+a);
  return desktop.slice(start,end);
};

test("new tool is a read-only planner, not an alternate native insertion system",()=>{
  assert.match(desktop,/mod premiere_caption_graphics;/);
  assert.match(desktop,/PremierePlanCaptionGraphics \{request:premiere_caption_graphics::Request\}/);
  assert.match(desktop,/"premiere_plan_caption_graphics"/);
  const staged=slice('"premiere_plan_caption_graphics" => {','"premiere_create_selective_srt" => {');
  assert.match(staged,/request\.validate\(\)\?/);
  assert.match(staged,/RiskLevel::Low/);
  const executed=slice('ToolAction::PremierePlanCaptionGraphics {request} => {',
    'ToolAction::PremiereCreateSelectiveSrt {request} => {');
  assert.match(executed,/premiere_bridge\.expected/);
  assert.match(executed,/expected\.sequence_guid\.is_none\(\)/);
  assert.match(executed,/premiere_graphics::list\(&graphics_library_path\(app\)\?\)/);
  assert.match(executed,/premiere_caption_graphics::plan\(&request,&saved\)/);
  assert.doesNotMatch(executed,/backup_premiere_project|executeTransaction|insert_mapped_graphic/);
});
test("source manifest, selected text, exact output hash and bounded batch are mandatory",()=>{
  assert.match(planner,/#\[serde\(deny_unknown_fields\)\]/);
  assert.match(planner,/premiere_selective_captions::Request/);
  assert.match(planner,/pub expected_srt_sha256:String/);
  assert.match(planner,/req\.captions\.cues\.iter\(\)\.enumerate\(\)/);
  assert.match(planner,/if !cue\.selected \{continue;\}/);
  assert.match(planner,/count>MAX_GRAPHICS/);
  assert.match(planner,/MAX_GRAPHICS:usize=32/);
  assert.match(planner,/selected_original_cue_indexes/);
  assert.match(planner,/Sha256::digest\(&read\)/);
  assert.match(planner,/read!=expected/);
  assert.match(planner,/eq_ignore_ascii_case\(&request\.expected_srt_sha256\)/);
});
test("source metadata and bytes checked, symlinks fail closed, no SRT rewriting",()=>{
  assert.match(planner,/fs::symlink_metadata\(path\)/);
  assert.match(planner,/before\.file_type\(\)\.is_symlink\(\)/);
  assert.match(planner,/before\.len\(\)>MAX_SOURCE_BYTES/);
  assert.match(planner,/file\.take\(MAX_SOURCE_BYTES\+1\)/);
  assert.match(planner,/after\.modified\(\)\.ok\(\)!=before\.modified\(\)\.ok\(\)/);
  assert.match(planner,/file_attributes\(\) & 0x400/);
  const route=planner.slice(planner.indexOf("fn read_exact_srt"),planner.indexOf("/// Strict, exact data-only conversion"));
  assert.doesNotMatch(route,/write_all|remove_file|rename|create_new/);
  assert.match(captions,/pub fn render\(&self\)/);
});
test("mapping revision, role, primitive and every explicit static field are checked",()=>{
  assert.match(planner,/req\.mapping!=saved\.mapping\.name\|\|req\.revision!=saved\.revision/);
  assert.match(planner,/f\.role=="caption_text"&&f\.primitive_type=="string"/);
  assert.match(planner,/req\.static_fields\.len\(\)!=others/);
  assert.match(planner,/self\.static_fields\.contains_key\("caption_text"\)/);
  assert.match(planner,/batch\.resolve\(saved\)\?/);
  assert.match(graphics,/Every mapped role needs an explicit value/);
});
test("native existing graphics implementation provides real typed insertion and readback",()=>{
  assert.match(planner,/premiere_graphics::Item\{seconds:start/);
  assert.match(planner,/duration_seconds:Some\(end-start\)/);
  assert.match(planner,/requires_next_tool":"premiere_batch_graphics"/);
  assert.match(host,/async function insertMappedGraphic/);
  assert.match(host,/graphicsTrackSnapshot/);
  assert.match(host,/verificationStatus|status = "applied"|result\.status = "applied"/);
  const dispatch=slice("ToolAction::PremiereBatchGraphics {batch} => {","ToolAction::PremiereBatchFinish{targets} => {");
  assert.match(dispatch,/state\.graphics_running\.begin/);
  assert.match(dispatch,/stage_graphics_batch/);
  assert.match(dispatch,/saved\.mapping\.validate_local_template\(\)/);
  assert.match(dispatch,/backup_premiere_project/);
  assert.match(dispatch,/premiere_graphics::run_batch/);
  assert.match(dispatch,/insert_mapped_graphic/);
});
test("both planner and existing native batch reject stale mapping revisions",()=>{
  assert.match(planner,/MOGRT mapping changed/);
  assert.match(graphics,/self\.revision != saved\.revision/);
  assert.match(graphics,/saved\.mapping\.validate\(\)\?/);
  assert.match(graphics,/no role inference/i);
});
test("native host completion, delivery and user approval remain explicitly unverified",()=>{
  assert.match(planner,/"requires_new_high_risk_approval":true/);
  assert.match(planner,/"saved_mapping_reference_inspected":false/);
  assert.match(planner,/"native_timeline_collision_checked":false/);
  assert.match(planner,/"native_graphics_inserted":false/);
  assert.match(planner,/"captions_burned_in":false/);
  assert.match(planner,/"adobe_host_tested":false/);
  assert.match(planner,/"retry_automatically":false/);
  assert.match(planner,/fn exact_manifest_hash_and_mapping_yield_native_executable_batch_without_host_write/);
  assert.match(planner,/fn edited_srt_bytes_bad_hash_and_wrong_mapping_fail_closed/);
  assert.match(planner,/fn missing_caption_role_bad_static_field_and_too_many_cues_fail/);
});
