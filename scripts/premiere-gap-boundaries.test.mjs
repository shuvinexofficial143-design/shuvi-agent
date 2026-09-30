import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const acceptance=readFileSync(new URL("../src-tauri/src/premiere_acceptance.rs",import.meta.url),"utf8");
const speed=readFileSync(new URL("../integrations/premiere-uxp/speed-workflows.js",import.meta.url),"utf8");
const captions=readFileSync(new URL("../integrations/premiere-uxp/caption-workflows.js",import.meta.url),"utf8");

test("public-API gaps remain explicit instead of silently promoted",()=>{
  for(const key of [
    "native_speed_time_remap_write","native_linked_group_membership","caption_track_text_write",
    "multicam_creation_switching","mask_creation_editing","scale_to_frame","stable_track_identity"
  ]) assert.match(acceptance,new RegExp(`"${key}"`));
  assert.match(speed,/write_supported: false/);
  assert.match(speed,/native_speed_unit: "adobe_native_unverified"/);
  assert.match(speed,/rate_comparison_verified: false/);
  assert.match(captions,/native_caption_creation: false/);
  assert.match(captions,/native_caption_text_editing: false/);
});

test("delivery evidence never equates file stability with completion",()=>{
  assert.match(acceptance,/"ame_event_correlation":\{"state":"documented_event_uncorrelated"/);
  assert.match(acceptance,/"encoded_media_validation":\{"state":"hook_implemented_unverified"/);
  assert.match(acceptance,/encoder_event_correlation_verified":false/);
  assert.match(acceptance,/encoded_media_validation_verified":false/);
  assert.match(acceptance,/"export_completion":\{"state":"not_verified"/);
});

test("cancellation and third-party graphics boundaries are machine-readable",()=>{
  assert.match(acceptance,/"native_inflight_cancellation":\{"state":"cooperative_boundary_only"/);
  assert.match(acceptance,/native_inflight_abort_verified":false/);
  assert.match(acceptance,/cooperative_between_dispatches_only":true/);
  assert.match(acceptance,/"third_party_mogrt_semantics":\{"state":"inspected_only"/);
  assert.doesNotMatch(acceptance,/native_inflight_abort_verified":true/);
});


test("final semantic gaps remain explicit and untrusted validator ingestion stays private",()=>{
  assert.match(acceptance,/"project_item_overwrite_semantics":\{"state":"accepted_unverified"/);
  assert.match(acceptance,/"subclip_hard_boundary_mode":\{"state":"accepted_unverified"/);
  assert.match(acceptance,/receipt ingestion remains internal-only/);
  const jobs=readFileSync(new URL("../src-tauri/src/premiere_export_jobs.rs",import.meta.url),"utf8");
  assert.match(jobs,/struct MediaValidationReceipt/);
  assert.doesNotMatch(jobs,/pub struct MediaValidationReceipt/);
  assert.match(jobs,/fn record_media_validation/);
  assert.doesNotMatch(jobs,/pub fn record_media_validation/);
});
