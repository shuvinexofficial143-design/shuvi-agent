import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const reopen=readFileSync("src-tauri/src/premiere_caption_reopen.rs","utf8");
const save=readFileSync("src-tauri/src/premiere_caption_save_binding.rs","utf8");
const captions=readFileSync("src-tauri/src/premiere_caption_graphics.rs","utf8");
const lifecycle=readFileSync("src-tauri/src/premiere_project_lifecycle.rs","utf8");
const desktop=readFileSync("src-tauri/src/lib.rs","utf8");
const host=readFileSync("integrations/premiere-uxp/main.js","utf8");
const start=(opening,closing)=>{
  const from=desktop.indexOf(opening),to=desktop.indexOf(closing,from);
  assert.ok(from>=0&&to>from,"missing exact Rust route "+opening);
  return desktop.slice(from,to);
};

test("typed post-open caption audit requires three separate approved receipts and one existing manifest",()=>{
  assert.match(desktop,/mod premiere_caption_reopen;/);
  assert.match(desktop,/PremiereVerifyReopenedCaptionGraphics \{request:premiere_caption_graphics::Request,receipt:Value,save_receipt:Value,open_receipt:Value\}/);
  const staged=start('"premiere_verify_reopened_caption_graphics" => {','"premiere_verify_saved_caption_graphics" => {');
  assert.match(staged,/Premier[eE]VerifyReopenedCaptionGraphics\{request,receipt,save_receipt,open_receipt\}/);
  assert.match(staged,/request\.validate\(\)\?/);
  assert.match(staged,/RiskLevel::Low/);
  assert.match(staged,/128\*1024/);
  assert.match(staged,/32\*1024/);
});
test("read-only post-open verifier independently rechecks save, opened artifact, source and every native clip",()=>{
  const handler=start('ToolAction::PremiereVerifyReopenedCaptionGraphics {request,receipt,save_receipt,open_receipt} => {',
    'ToolAction::PremiereVerifySavedCaptionGraphics {request,receipt,save_receipt} => {');
  assert.match(handler,/premiere_caption_save_binding::saved_after\(/);
  assert.match(handler,/premiere_caption_save_binding::snapshot\(path\)\?/);
  assert.match(handler,/premiere_caption_reopen::validate_open_receipt/);
  assert.match(handler,/premiere_caption_graphics::plan\(&request,&saved_mapping\)\?/);
  assert.match(handler,/premiere_caption_graphics::validate_audit_receipt/);
  assert.match(handler,/request\("inspect_context"/);
  assert.match(handler,/request\("verify_caption_graphics"/);
  assert.match(handler,/premiere_caption_reopen::assess/);
  assert.match(handler,/"fresh_session_reopen_verified":false/);
  assert.match(handler,/"automatically_opened_or_saved":false/);
  assert.doesNotMatch(handler,/\.request\("open_project"|\.request\("save_project"|\.request\("export_sequence"|insert_mapped_graphic|backup_premiere_project/);
});
test("owner-approved native Project.open keeps path and disk identity and no implicit save",()=>{
  const staged=start('"premiere_open_project" => {','"premiere_bridge_start" =>');
  assert.match(staged,/RiskLevel::High/);
  const executed=start('ToolAction::PremiereOpenProject{path} => {','ToolAction::PremiereBridgeStart => {');
  assert.match(executed,/premiere_project_lifecycle::preflight_open/);
  assert.match(executed,/request\("open_project"/);
  assert.match(executed,/premiere_project_lifecycle::assess_open/);
  assert.match(lifecycle,/pub fn assess_open/);
  assert.match(host,/projectLifecycle\.openProject/);
  assert.doesNotMatch(executed,/save_project|backup_premiere_project/);
});
test("stale or forged open receipts are rejected by exact native and disk contract",()=>{
  assert.match(reopen,/pub fn validate_open_receipt/);
  assert.match(reopen,/receipt\["post_state_verified"\]!=true/);
  assert.match(reopen,/host\["operation"\]!="open"/);
  assert.match(reopen,/host\["projectIdentityVerified"\]!=true/);
  assert.match(reopen,/host\["projectGuid"\]!=expected_project_guid/);
  assert.match(reopen,/host\["activeGuid"\]!=expected_project_guid/);
  assert.match(reopen,/proof\["disk_unchanged_during_open"\]!=true/);
  assert.match(reopen,/proof\["project_verified"\]!=true/);
  assert.match(reopen,/reported!=\*saved\|\|reported!=disk\.fingerprint/);
  assert.match(save,/Sha256::new\(\)/);
  assert.match(captions,/pub fn validate_audit_receipt/);
});
test("independently checked reopened source, project, context and captions never imply new process or rendered video",()=>{
  assert.match(reopen,/let disk_same=before==after/);
  assert.match(reopen,/context_before,context_after/);
  assert.match(reopen,/ctx\.pointer\("\/activeSequence\/guid"\)/);
  assert.match(reopen,/native_current_session_caption_values_verified/);
  assert.match(reopen,/"post_approved_open_saved_caption_evidence_consistent":correlated/);
  for(const key of [
    "fresh_application_session_proven",
    "fresh_session_reopen_verified",
    "durable_caption_semantics_across_new_process_proven",
    "visual_motion_graphics_verified",
    "exported_mp4_verified",
    "retry_automatically"
  ]) assert.match(reopen,new RegExp('"'+key+'":false'));
  assert.match(reopen,/fn separately_approved_open_and_exact_post_open_caption_evidence_correlates/);
  assert.match(reopen,/fn stale_saved_bytes_or_forged_open_receipts_are_rejected/);
  assert.match(reopen,/fn changed_native_caption_or_active_sequence_cannot_claim_reopened_consistency/);
});
