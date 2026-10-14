import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const acceptance=readFileSync(new URL("../src-tauri/src/premiere_acceptance.rs",import.meta.url),"utf8");
const uxp=readFileSync(new URL("../integrations/premiere-uxp/main.js",import.meta.url),"utf8");
const speed=readFileSync(new URL("../integrations/premiere-uxp/speed-workflows.js",import.meta.url),"utf8");
const mogrt=readFileSync(new URL("../integrations/premiere-uxp/mogrt-workflows.js",import.meta.url),"utf8");
const session=readFileSync(new URL("../src-tauri/src/premiere_edit_session.rs",import.meta.url),"utf8");
const jobs=readFileSync(new URL("../src-tauri/src/premiere_export_jobs.rs",import.meta.url),"utf8");

test("documented-unsupported native gaps cannot silently promote",()=>{
  for(const key of [
    "native_speed_time_remap_write","native_linked_group_membership","caption_track_text_write",
    "multicam_creation_switching","mask_creation_editing"
  ]) assert.match(acceptance,new RegExp(`"${key}":\\{"state":"unsupported_documented"`));
  assert.match(acceptance,/\("linked_clip_membership",2,true,true\)/);
  assert.match(speed,/write_supported: false/);
  assert.doesNotMatch(speed,/executeTransaction|createSetSpeedAction\(/);
  assert.match(uxp,/creationSupported:false,switchingSupported:false/);
});

test("conditional readbacks stay conditional instead of becoming blanket verification",()=>{
  assert.match(acceptance,/"video_transition_presence":\{"state":"conditional_verified_readback"/);
  assert.match(acceptance,/"source_in_out":\{"state":"conditional_verified_readback"/);
  assert.match(acceptance,/"project_save_persistence":\{"state":"conditional_verified_file_write"/);
  assert.match(acceptance,/"scale_to_frame":\{"state":"accepted_unverified"/);
  assert.match(acceptance,/"project_item_overwrite_semantics":\{"state":"accepted_unverified"/);
  assert.match(acceptance,/"subclip_hard_boundary_mode":\{"state":"accepted_unverified"/);
});

test("export evidence separates file, parser and encoder completion",()=>{
  assert.match(acceptance,/"export_completion":\{"state":"not_verified"/);
  assert.match(acceptance,/"ame_event_correlation":\{"state":"documented_event_uncorrelated"/);
  assert.match(acceptance,/receipt ingestion remains internal-only/);
  assert.match(jobs,/completion_verified":false/);
  assert.match(jobs,/encoder_completion_verified:false/);
  assert.doesNotMatch(jobs,/pub fn record_media_validation/);
});

test("cancellation never implies native abort rollback or safe retry",()=>{
  assert.match(session,/"cancelled_after_apply"/);
  assert.match(session,/"uncertain"/);
  assert.match(session,/does not roll it back/);
  assert.match(session,/cannot prove an already dispatched native mutation stopped/);
  assert.match(acceptance,/native_inflight_abort_verified":false/);
  assert.match(acceptance,/automatic_rollback_verified":false/);
});

test("MOGRT semantic identity remains caller supplied and visually reviewable",()=>{
  assert.match(mogrt,/semanticRolesVerified: false/);
  assert.match(mogrt,/templateSourceIdentityVerified: false/);
  assert.match(mogrt,/thirdPartyTemplateSafetyVerified: false/);
  assert.match(mogrt,/safeAutomaticApply: false/);
  assert.match(mogrt,/requiresVisualReview: true/);
  assert.match(uxp,/thirdPartySemanticIdentityVerified:false/);
});

test("source-safe implementation does not claim current runtime verification",()=>{
  assert.match(acceptance,/"windows_premiere_runtime":\{"state":"not_verified"/);
  assert.match(acceptance,/"current_source_revision_bound":false/);
  assert.match(acceptance,/"production_ready":false/);
});
