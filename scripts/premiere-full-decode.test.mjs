import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=readFileSync("src-tauri/src/premiere_full_decode.rs","utf8");
const native=readFileSync("src-tauri/src/lib.rs","utf8");
const final=readFileSync("src-tauri/src/premiere_final_delivery.rs","utf8");
const probe=readFileSync("src-tauri/src/after_effects_media_validation.rs","utf8");
const section=(input,start,end)=>{
  const a=input.indexOf(start),b=input.indexOf(end,a);
  assert.ok(a>=0&&b>a,"Expected exact bounded source section: "+start);
  return input.slice(a,b);
};
const parser=section(native,'"premiere_verify_mp4_decode" => {','"premiere_inspect_final_delivery" => {');
const execution=section(native,
  'ToolAction::PremiereVerifyMp4Decode{job_id,expected_project_guid,expected_sequence_guid,budget_secs} => {',
  'ToolAction::PremiereInspectFinalDelivery{job_id,expected_project_guid,expected_sequence_guid} => {');

test("full decode is a separately registered read-only exact-job action",()=>{
  assert.match(native,/mod premiere_full_decode;/);
  assert.match(native,/PremiereVerifyMp4Decode \{job_id:String,expected_project_guid:String,expected_sequence_guid:String,budget_secs:u64\}/);
  assert.match(native,/\| "premiere_verify_mp4_decode"/);
  assert.match(parser,/Uuid::parse_str\(&job_id\)/);
  assert.match(parser,/expected_project_guid/);
  assert.match(parser,/expected_sequence_guid/);
  assert.match(parser,/RiskLevel::Low/);
});
test("full decoder rejects invalid budget before spawn and does not silently increase time",()=>{
  assert.match(parser,/15\.\.=180/);
  assert.match(source,/const MAX_BUDGET_SECS:u64=180/);
  assert.match(source,/const MIN_BUDGET_SECS:u64=15/);
  assert.match(source,/started\.elapsed\(\)>=timeout/);
  assert.match(source,/child\.kill\(\)/);
  assert.match(source,/child\.try_wait\(\)/);
});
test("cannot run arbitrary model-supplied shell command or decoder from PATH",()=>{
  assert.match(source,/pub fn detect_trusted_decoder\(\)->Option<PathBuf>/);
  assert.match(source,/std::env::var_os\("ProgramFiles"\)/);
  assert.match(source,/join\("ffmpeg.exe"\)/);
  assert.match(source,/canon\.starts_with\(&root_c\)/);
  assert.match(source,/file_attributes\(\)&0x400/);
  assert.match(source,/detect_trusted_decoder\(\)\.as_deref\(\)!=Some\(exe\)/);
  assert.doesNotMatch(source,/cmd\.exe|powershell\.exe|Command::new\("ffmpeg"\)|env::var\("PATH"\)/);
});
test("decode runs actual video and optional audio through null sink, not copied streams or output file",()=>{
  assert.match(source,/"-map","0:v","-map","0:a\?"/);
  assert.match(source,/"-xerror"/);
  assert.match(source,/"-err_detect","explode"/);
  assert.match(source,/"-protocol_whitelist","file,pipe"/);
  assert.match(source,/"-f","null","-progress","pipe:1","NUL"/);
  assert.match(source,/stdin\(Stdio::null\(\)\)/);
  assert.doesNotMatch(source,/args\(\["-c","copy"/);
});
test("capture has bounded stdout/stderr and errors fail closed",()=>{
  assert.match(source,/MAX_STDOUT:usize=64\*1024/);
  assert.match(source,/MAX_STDERR:usize=16\*1024/);
  assert.match(source,/overflow\.store\(true,Ordering::SeqCst\)/);
  assert.match(source,/!status\.is_some_and\(\|s\|s\.success\(\)\)\|\|!error\.is_empty\(\)/);
});
test("full decode needs final progress=end, decoded frames and nearly full expected stream duration",()=>{
  assert.match(source,/endings!=1/);
  assert.match(source,/progress=end/);
  assert.match(source,/frames>0&&seconds\.is_finite\(\)/);
  assert.match(source,/seconds>=expected_duration\*0\.97/);
  assert.match(source,/one_final_progress_end_and_full_duration_are_mandatory/);
  assert.match(source,/stream_0_0_q=-1\.0/);
  assert.match(source,/invalid_or_truncated_progress_never_promotes_success/);
});
test("native handler selects only exact job, releases mutex before expensive decoder, never writes export store",()=>{
  const lock=execution.indexOf("premiere_export_jobs_io.lock()");
  const clone=execution.indexOf(".cloned().ok_or(");
  const decoder=execution.indexOf("premiere_full_decode::inspect(");
  assert.ok(lock>=0&&clone>lock&&decoder>clone);
  assert.match(execution,/"read_only":true/);
  assert.doesNotMatch(execution,/premiere_export_jobs::save/);
  assert.doesNotMatch(execution,/premiere_bridge\.request/);
  assert.doesNotMatch(execution,/request\("export_sequence"/);
});
test("output file sha256 and independent structural/ffprobe checks are combined without modifying MP4",()=>{
  assert.match(source,/premiere_final_delivery::eligible_job/);
  assert.match(source,/premiere_media_relink::fingerprint\(&job\.output\)/);
  assert.match(source,/premiere_final_delivery::inspect/);
  assert.match(source,/premiere_media_relink::same_file\(&before,&after\)/);
  assert.match(final,/after_effects_media_validation::validate_with_budget/);
  assert.match(probe,/media_decode_verified":false/);
});
test("full decoded MP4 never becomes claimed Adobe encoder completion, human playback or visual approval",()=>{
  assert.match(source,/"adobe_encoder_completion_verified":false/);
  assert.match(source,/"export_job_output_attribution_verified":false/);
  assert.match(source,/"human_playback_verified":false/);
  assert.match(source,/"audio_visual_quality_verified":false/);
  assert.match(source,/"final_delivery_ready":false/);
  assert.match(execution,/"final_delivery_ready":false/);
  assert.match(execution,/"encoder_completion_verified":false/);
});

test("a fully decodable preexisting MP4 is not credited as the current export job",()=>{
  assert.match(source,/let new_output_observed=!job\.output_existed_before/);
  assert.match(source,/job\.before\.exists==false/);
  assert.match(source,/job\.observations\.iter\(\)\.any\(\|o\|o\.exists&&o\.size_bytes==Some\(after\.size_bytes\)\)/);
  assert.match(source,/job\.bridge_state=="execution_status_unknown"/);
  assert.match(source,/"job_output_attribution_blocked":attribution_blocked\|\|!new_output_observed/);
  assert.match(source,/"export_job_output_attribution_verified":false/);
  assert.match(source,/"final_delivery_ready":false/);
});
