import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync("src-tauri/src/premiere_delivery_spec.rs","utf8");
const native=readFileSync("src-tauri/src/lib.rs","utf8");
const media=readFileSync("src-tauri/src/premiere_final_delivery.rs","utf8");
const exportJobs=readFileSync("src-tauri/src/premiere_export_jobs.rs","utf8");
function section(s,a,b){
  const i=s.indexOf(a),j=s.indexOf(b,i);
  assert.ok(i>=0&&j>i,"Expected bounded Rust handler: "+a);
  return s.slice(i,j);
}
const parser=section(native,'"premiere_inspect_delivery_spec" => {','"premiere_inspect_final_delivery" => {');
const runner=section(native,
  'ToolAction::PremiereInspectDeliverySpec{job_id,expected_project_guid,expected_sequence_guid,spec} => {',
  'ToolAction::PremiereInspectFinalDelivery{job_id,expected_project_guid,expected_sequence_guid} => {');

test("new exact-job technical QC tool is registered as low-risk and typed",()=>{
  assert.match(native,/mod premiere_delivery_spec;/);
  assert.match(native,/PremiereInspectDeliverySpec \{job_id:String/);
  assert.match(native,/\| "premiere_inspect_delivery_spec"/);
  assert.match(parser,/Uuid::parse_str\(&job_id\)/);
  assert.match(parser,/premiere_delivery_spec::Spec/);
  assert.match(parser,/spec\.validate\(\)\?/);
  assert.match(parser,/RiskLevel::Low/);
});
test("cannot use unknown spec keys, invalid dimensions or unbounded tolerance",()=>{
  assert.match(source,/#\[serde\(deny_unknown_fields\)\]/);
  assert.match(source,/self\.schema_version!=1/);
  assert.match(source,/self\.expected_duration_seconds\.is_finite\(\)/);
  assert.match(source,/self\.duration_tolerance_seconds\.is_finite\(\)/);
  assert.match(source,/self\.duration_tolerance_seconds>10\.0/);
  assert.match(source,/self\.duration_tolerance_seconds>self\.expected_duration_seconds\*0\.1/);
  assert.match(source,/\!\(128\.\.=8192\)\.contains\(&self\.width\)/);
});
test("no metadata, inconsistent hashes or unsupported structure can be technical success",()=>{
  assert.match(source,/delivery_media_integrity_verified/);
  assert.match(source,/file_bytes_unchanged_during_probe/);
  assert.match(source,/stream_metadata_parse_verified/);
  assert.match(source,/if !integrity/);
  assert.match(source,/let spec_match=integrity&&duration_matches&&video_matches&&audio_matches/);
  assert.match(media,/premiere_media_relink::same_file\(&before,&after\)/);
});
test("timed sequence output must be within tolerance and have one exact-size video stream",()=>{
  assert.match(source,/duration_seconds/);
  assert.match(source,/expected_duration_seconds\)\.abs\(\)/);
  assert.match(source,/video\.len\(\)==1&&width==Some\(u64::from\(spec\.width\)\)/);
  assert.match(source,/height==Some\(u64::from\(spec\.height\)\)/);
  assert.match(source,/video_stream_count_or_dimensions_mismatch/);
  assert.match(source,/output_duration_mismatch_or_missing/);
});
test("optional or required audio behavior is explicit; no fake sound quality certification",()=>{
  assert.match(source,/!spec\.require_audio\|\|/);
  assert.match(source,/channels/);
  assert.match(source,/sample_rate/);
  assert.match(source,/required_audio_stream_missing_or_invalid/);
  assert.match(source,/"audio_mix_quality_verified":false/);
});
test("QC only reads existing recorded job and never starts or saves an Adobe action",()=>{
  assert.match(runner,/premiere_export_jobs_io\.lock\(\)/);
  assert.match(runner,/jobs\.jobs\.iter\(\)\.find\(\|j\|j\.job_id==job_id\)/);
  assert.match(runner,/premiere_delivery_spec::inspect/);
  assert.match(runner,/"read_only":true/);
  assert.doesNotMatch(runner,/premiere_bridge\.request/);
  assert.doesNotMatch(runner,/premiere_export_jobs::save/);
  assert.doesNotMatch(runner,/request\("export_sequence"/);
  assert.match(exportJobs,/encoder_completion_verified:false/);
});
test("positive technical result does not imply existing job generated it or artist approved it",()=>{
  assert.match(source,/"spec_was_known_before_export":false/);
  assert.match(source,/"file_generated_by_this_export_job_verified":false/);
  assert.match(source,/"human_playback_verified":false/);
  assert.match(source,/"subtitle_readability_verified":false/);
  assert.match(source,/"graphics_render_quality_verified":false/);
  assert.match(source,/"encoder_completion_verified":false/);
  assert.match(source,/"final_delivery_ready":false/);
  assert.match(runner,/"export_job_attribution_verified":false/);
});
test("Rust unit tests exercise 30s and 300s specs, missing audio and mismatching output",()=>{
  assert.match(source,/matching_30s_media_is_technical_only/);
  assert.match(source,/different_duration_dimensions_or_missing_audio_are_rejected/);
  assert.match(source,/unsupported_or_unbounded_specs_fail_before_any_file_access/);
  assert.match(source,/spec\.expected_duration_seconds=300\.0/);
});
