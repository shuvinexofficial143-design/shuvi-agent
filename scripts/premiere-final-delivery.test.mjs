import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const runtime=readFileSync("src-tauri/src/lib.rs","utf8");
const deliver=readFileSync("src-tauri/src/premiere_final_delivery.rs","utf8");
const validator=readFileSync("src-tauri/src/after_effects_media_validation.rs","utf8");
const exportJobs=readFileSync("src-tauri/src/premiere_export_jobs.rs","utf8");
const arm=runtime.slice(runtime.indexOf("ToolAction::PremiereInspectFinalDelivery{job_id"),
  runtime.indexOf("ToolAction::PremiereExportStatus {job_id} => {",
    runtime.indexOf("ToolAction::PremiereInspectFinalDelivery{job_id")));
test("Final MP4 inspection is an independently registered read-only typed tool",()=>{
  assert.match(runtime,/"premiere_inspect_final_delivery" =>/);
  const p=runtime.slice(runtime.indexOf('"premiere_inspect_final_delivery" => {'),
    runtime.indexOf('"premiere_export_status" => {'));
  assert.match(p,/Uuid::parse_str/);
  assert.match(p,/expected_project_guid/);
  assert.match(p,/expected_sequence_guid/);
  assert.match(p,/RiskLevel::Low/);
  assert.match(runtime,/mod premiere_final_delivery;/);
});
test("Inspect selects only exact native export job and never triggers an export or side effect",()=>{
  assert.ok(arm.length>300);
  assert.match(arm,/jobs\.jobs\.iter\(\)\.find\(\|j\|j\.job_id==job_id\)/);
  assert.match(arm,/premiere_final_delivery::inspect/);
  assert.match(arm,/"read_only":true/);
  assert.doesNotMatch(arm,/premiere_bridge\.request/);
  assert.doesNotMatch(arm,/request\("export_sequence"/);
  assert.doesNotMatch(arm,/premiere_export_jobs::save/);
});
test("Export record requires exact project and sequence identity and accepted host dispatch",()=>{
  assert.match(deliver,/job\.project_guid!=expected_project_guid\|\|job\.sequence_guid!=expected_sequence_guid/);
  assert.match(deliver,/bridge_state\.as_str\(\),"accepted"\|"queued"\|"execution_status_unknown"/);
  assert.match(deliver,/eq_ignore_ascii_case\("mp4"\)/);
  assert.match(exportJobs,/pub output_existed_before:bool/);
});
test("MP4 evidence uses existing bounded structural parser and trusted ffprobe metadata",()=>{
  assert.match(deliver,/premiere_media_relink::fingerprint\(&job\.output\)/);
  assert.match(deliver,/after_effects_media_validation::validate_with_budget/);
  assert.match(validator,/"mp4"\|"mov"\|"m4v"\|"m4a"/);
  assert.match(validator,/media_decode_verified":false/);
  assert.match(deliver,/file_bytes_unchanged_during_probe/);
  assert.match(deliver,/container_structure_verified/);
  assert.match(deliver,/stream_metadata_parse_verified/);
});
test("File integrity and stream probe never promote unverified encoder completion",()=>{
  assert.match(deliver,/export_job_output_attribution_verified":false/);
  assert.match(deliver,/full_media_decode_verified":false/);
  assert.match(deliver,/playback_verified":false/);
  assert.match(deliver,/final_delivery_complete_verified":false/);
  assert.match(runtime,/"encoder_completion_independently_proven":false/);
  assert.match(runtime,/"final_delivery_ready":false/);
});
test("Rust unit tests reject changed MP4 bytes, wrong project and unaccepted export job",()=>{
  assert.match(deliver,/matching_mp4_metadata_does_not_upgrade_encoder_completion/);
  assert.match(deliver,/reject_wrong_project_or_no_native_acceptance/);
  assert.match(deliver,/assert_eq!\(result\["final_delivery_complete_verified"\],false\)/);
});
