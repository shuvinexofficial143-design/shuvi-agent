import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const save=readFileSync("src-tauri/src/premiere_caption_save_binding.rs","utf8");
const native=readFileSync("src-tauri/src/premiere_caption_graphics.rs","utf8");
const disk=readFileSync("src-tauri/src/premiere_project_persistence.rs","utf8");
const desktop=readFileSync("src-tauri/src/lib.rs","utf8");
const bridge=readFileSync("src-tauri/src/premiere_bridge.rs","utf8");
const host=readFileSync("integrations/premiere-uxp/main.js","utf8");
function arm(start,end){
  const a=desktop.indexOf(start),b=desktop.indexOf(end,a);
  assert.ok(a>=0&&b>a,"Missing bounded Shuvi native route "+start);
  return desktop.slice(a,b);
}
test("new source-only verifier reuses separate existing approved project save and exact native graphics audit",()=>{
  assert.match(desktop,/mod premiere_caption_save_binding;/);
  assert.match(desktop,/PremiereVerifySavedCaptionGraphics \{request:premiere_caption_graphics::Request,receipt:Value,save_receipt:Value\}/);
  const parser=arm('"premiere_verify_saved_caption_graphics" => {','"premiere_verify_caption_graphics" => {');
  assert.match(parser,/PremiereVerifySavedCaptionGraphics\{request,receipt,save_receipt\}/);
  assert.match(parser,/RiskLevel::Low/);
  assert.match(parser,/receipt.*is required/);
  const handler=arm('ToolAction::PremiereVerifySavedCaptionGraphics {request,receipt,save_receipt} => {',
    'ToolAction::PremiereVerifyCaptionGraphics {request,receipt} => {');
  assert.match(handler,/premiere_caption_save_binding::saved_after\(/);
  assert.match(handler,/premiere_caption_save_binding::snapshot\(path\)/);
  assert.match(handler,/premiere_caption_graphics::plan\(&request,&saved\)/);
  assert.match(handler,/premiere_caption_graphics::validate_audit_receipt/);
  assert.match(handler,/premiere_bridge\.request\("verify_caption_graphics"/);
  assert.match(handler,/premiere_caption_save_binding::assess\(/);
  assert.match(handler,/"fresh_session_reopen_verified":false/);
  assert.match(handler,/"saved_project_caption_semantics_verified":false/);
  assert.doesNotMatch(handler,/\.request\("save_project"|backup_premiere_project|insert_mapped_graphic/);
  assert.match(bridge,/"verify_caption_graphics"/);
  assert.match(host,/async function verifyCaptionGraphics\(/);
});
test("separate native save tool reports actual accepted path, disk pre/post observation without fake edit semantics",()=>{
  const handler=arm('ToolAction::PremiereSaveProject => {','ToolAction::AfterEffectsCapabilityReport => {');
  assert.match(handler,/premiere_project_persistence::fingerprint\(&expected_path\)/);
  assert.match(handler,/premiere_checkpoint::create_checkpoint/);
  assert.match(handler,/request\("save_project"/);
  assert.match(handler,/premiere_project_persistence::assess\(/);
  assert.match(handler,/"persistence_evidence":evidence/);
  assert.match(handler,/"edit_semantics_verified":false/);
  assert.match(disk,/fnv1a64_noncryptographic_change_detector/);
});
test("strict save receipt requires native acceptance and complete before/after on-disk evidence",()=>{
  assert.match(save,/pub fn saved_after\(/);
  assert.match(save,/receipt\["native_accepted"\]!=true/);
  assert.match(save,/receipt\["save"\]\["saved"\]!=true/);
  assert.match(save,/receipt\["post_state_verified"\]!=true/);
  assert.match(save,/persistence\["persistence_verified"\]!=true/);
  assert.match(save,/persistence\["independent_file_write_observed"\]!=true/);
  assert.match(save,/before\.path!=project_path\|\|after\.path!=project_path/);
  assert.match(save,/before==after/);
  assert.match(save,/persistence\["edit_semantics_verified"\]!=false/);
  assert.match(save,/data\.len\(\)>32\*1024/);
});
test("project SHA256 is streamed and snapshots must be stable against host scanning",()=>{
  assert.match(save,/pub fn snapshot\(path:&str\)/);
  assert.match(save,/fs::symlink_metadata\(p\)/);
  assert.match(save,/meta\.file_type\(\)\.is_symlink\(\)/);
  assert.match(save,/meta\.file_attributes\(\) & 0x400/);
  assert.match(save,/Sha256::new\(\)/);
  assert.match(save,/digest\.update\(&buffer\[\.\.n\]\)/);
  assert.match(save,/let before=premiere_project_persistence::fingerprint\(path\)\?/);
  assert.match(save,/let after=premiere_project_persistence::fingerprint\(path\)\?/);
  assert.match(save,/total!=before\.size_bytes\|\|before!=after/);
  const handler=arm('ToolAction::PremiereVerifySavedCaptionGraphics {request,receipt,save_receipt} => {',
    'ToolAction::PremiereVerifyCaptionGraphics {request,receipt} => {');
  const before=handler.indexOf('let before_disk=premiere_caption_save_binding::snapshot(path)?');
  const host=handler.indexOf('premiere_bridge.request("verify_caption_graphics"');
  const after=handler.indexOf('let after_disk=premiere_caption_save_binding::snapshot(path)?');
  assert.ok(before>=0&&before<host&&host<after,"Snapshot must surround fresh host readback.");
});
test("saved-caption evidence cannot be promoted to durable caption semantics or video output",()=>{
  assert.match(save,/"current_host_and_project_save_evidence_consistent":corroborated/);
  assert.match(save,/"project_save_receipt_source_authenticated":false/);
  assert.match(save,/"saved_project_caption_semantics_verified":false/);
  assert.match(save,/"fresh_session_reopen_verified":false/);
  assert.match(save,/"visual_caption_animation_verified":false/);
  assert.match(save,/"exported_mp4_verified":false/);
  assert.match(save,/"automatic_retry_safe":false/);
  assert.match(native,/pub fn validate_audit_receipt\(/);
  assert.match(save,/fn valid_save_receipt_and_stable_file_correlate_without_reopen_claim/);
  assert.match(save,/fn old_or_fabricated_save_receipt_does_not_satisfy_source_binding/);
  assert.match(save,/fn missing_host_or_changed_source_or_file_bytes_never_promote_evidence/);
});
