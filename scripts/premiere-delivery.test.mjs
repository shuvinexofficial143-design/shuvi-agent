import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const delivery=readFileSync(new URL("../src-tauri/src/premiere_delivery.rs",import.meta.url),"utf8");
const uxp=readFileSync(new URL("../integrations/premiere-uxp/main.js",import.meta.url),"utf8");

test("AE exposes interchange and native frame delivery tools",()=>{
  for(const name of [
    "premiere_plan_interchange_export","premiere_export_fcpxml","premiere_export_otio",
    "premiere_export_aaf","premiere_export_frame","premiere_export_review_frames",
    "premiere_cancel_review_frame_export"
  ]) assert.match(rust,new RegExp(name));
});

test("AE uses stable ProjectConverter APIs",()=>{
  assert.match(uxp,/ProjectConverter/);
  assert.match(uxp,/exportAsFinalCutProXML/);
  assert.match(uxp,/exportAsOpenTimelineIO/);
  assert.match(uxp,/exportAAF/);
  assert.match(uxp,/Final Cut Pro XML export requires Premiere 26\.2\+/);
  assert.match(uxp,/AAF export requires Premiere 26\.3\+/);
});

test("AAF options use documented constants and setters",()=>{
  assert.match(uxp,/AAFExportOptions/);
  assert.match(uxp,/AAFExportAudioFormat\.WAV/);
  assert.match(uxp,/AAFExportAudioFormat\.AIFF/);
  for(const method of [
    "setBitsPerSample","setEmbedAudio","setExplodeToMono","setHandleFrames",
    "setInterleaveWithoutEffects","setMixdownVideo","setPreserveParentFolder",
    "setRenderAudioEffects","setSampleRate","setTrimSources","setVideoMixdownPresetPath"
  ]) assert.match(uxp,new RegExp(method));
});

test("interchange collision is blocked by default",()=>{
  assert.match(delivery,/output already exists and overwrite=false/);
  assert.match(delivery,/validate_output_file/);
  assert.match(rust,/Interchange export requires project\/sequence expectation without clip targets/);
});

test("native frame export uses Adobe Exporter only",()=>{
  assert.match(uxp,/Exporter\.exportSequenceFrame/);
  assert.match(uxp,/Native sequence frame export requires Premiere 25\.6\+/);
  assert.match(rust,/"native_frame_export":true/);
  assert.match(rust,/"screenshot_fallback":false/);
});

test("frame formats match documented stable list",()=>{
  assert.match(delivery,/"bmp"\|"dpx"\|"gif"\|"jpg"\|"exr"\|"png"\|"tga"\|"tif"/);
  assert.doesNotMatch(delivery,/"jpeg"/);
  assert.doesNotMatch(delivery,/"tiff"/);
});

test("review frame package is bounded unique and cancellable",()=>{
  assert.match(delivery,/MAX_FRAMES: usize = 16/);
  assert.match(delivery,/output paths must be unique/);
  assert.match(rust,/delivery_cancelled/);
  assert.match(rust,/PremiereCancelReviewFrameExport/);
  assert.match(rust,/if state\.delivery_cancelled\.load/);
});

test("delivery reports host acceptance and observed output separately",()=>{
  assert.match(rust,/"accepted":accepted/);
  assert.match(rust,/"file_observed":observed/);
  assert.match(rust,/"file_after":after/);
  const routes=rust.slice(rust.indexOf('ToolAction::PremiereExportInterchange {request} =>'),rust.indexOf('ToolAction::PremierePlanExport {output,preset,queue_to_ame,overwrite} =>'));
  assert.doesNotMatch(routes,/"completion_verified":accepted&&observed/);
  assert.doesNotMatch(routes,/"status":if accepted&&observed\{"exported"\}/);
  assert.equal((routes.match(/"completion_verified":false/g)||[]).length,5);
  assert.match(routes,/"requests_accepted":requests_accepted,"complete":false/);
  assert.match(routes,/"exported":0/);
  assert.match(routes,/if !observed\{uncertain=true;break;\}/);
});

test("native delivery exposes residual collision risk and rechecks each frame at dispatch",()=>{
  const target=readFileSync(new URL("../src-tauri/src/premiere_target.rs",import.meta.url),"utf8");
  const recheck=target.indexOf('crate::premiere_delivery::validate_output_file(output,overwrite)?');
  assert.ok(recheck>target.indexOf('self.bridge.request("inspect_context"'));
  assert.ok(recheck<target.indexOf('self.bridge.request(action, arguments, timeout).await'));
  assert.match(delivery,/"atomic":false/);
  assert.match(delivery,/"external_writer_race_possible":true/);
  assert.match(rust,/"unique_output_reserved":false/);
  const batch=rust.slice(rust.indexOf('ToolAction::PremiereExportReviewFrames {batch} =>'),rust.indexOf('ToolAction::PremierePlanExport {output,preset,queue_to_ame,overwrite} =>'));
  assert.ok(batch.indexOf('frame.validate()')>batch.indexOf('for (index,frame)'));
  assert.ok(batch.indexOf('frame.validate()')<batch.indexOf('match client.request('));
  assert.match(batch,/"status":"blocked_before_dispatch"/);
  const sequence=rust.slice(rust.indexOf('ToolAction::PremiereExportSequence { output,'),rust.indexOf('ToolAction::PremiereSaveProject =>'));
  assert.ok(sequence.indexOf('let recheck=')>sequence.indexOf('jobs.insert(job)?'));
  assert.ok(sequence.indexOf('let recheck=')<sequence.indexOf('let result=premiere_bridge.request'));
});

test("AE never promises external NLE compatibility or safe retry",()=>{
  assert.match(rust,/"compatibility_with_other_nles_guaranteed":false/);
  assert.match(rust,/"retry_safe":false/);
  assert.match(uxp,/retrySafe:false/);
});
