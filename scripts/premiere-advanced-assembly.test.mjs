import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const assembly=readFileSync(new URL("../src-tauri/src/premiere_assembly.rs",import.meta.url),"utf8");
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const uxp=readFileSync(new URL("../integrations/premiere-uxp/main.js",import.meta.url),"utf8");

test("Y2 keeps v1 and adds bounded v2 assembly",()=>{
  assert.match(assembly,/matches!\(self\.schema_version,1\|2\)/);
  assert.match(assembly,/MAX_SHOTS: usize = 64/);
  assert.match(assembly,/MAX_TRANSITIONS: usize = 32/);
  assert.match(assembly,/MAX_MUSIC: usize = 8/);
  assert.match(assembly,/MAX_BEATS: usize = 256/);
});

test("source ranges require both endpoints and use verified subclip correlation",()=>{
  assert.match(assembly,/source range requires both valid source_in and source_out/);
  assert.match(rust,/"create_subclip"/);
  assert.match(rust,/correlationVerified/);
  assert.match(rust,/createdItemId/);
  assert.match(uxp,/collectProjectItemsForCorrelation/);
  assert.match(uxp,/beforeIds/);
  assert.match(uxp,/correlationVerified/);
});

test("explicit A roll B roll overlay roles never imply vertical move",()=>{
  assert.match(assembly,/"a_roll"\|"b_roll"\|"overlay"/);
  assert.doesNotMatch(assembly,/vertical_move/);
  assert.match(rust,/"videoTrack":shot\.video_track/);
});

test("supplied beat indexes map deterministic shot times without beat detection",()=>{
  assert.match(assembly,/pub beat_index:Option<u32>/);
  assert.match(assembly,/self\.beats\.get\(index as usize\)/);
  assert.match(rust,/"inferred_beat_detection":false/);
});

test("transition match names are preflighted and exact clip correlation is required",()=>{
  assert.match(rust,/"list_video_transitions"/);
  assert.match(rust,/resolve_video_clip_index/);
  assert.match(rust,/"add_video_transition"/);
  assert.match(assembly,/Could not correlate exactly one inserted video clip/);
});

test("music graphics and chapters execute through existing typed native routes",()=>{
  assert.match(rust,/"insert_project_item"/);
  assert.match(rust,/premiere_graphics::run_batch/);
  assert.match(rust,/"add_marker"/);
  assert.match(rust,/"created_subclips":subclips/);
});

test("one checkpoint is reused by advanced assembly and V2 graphics",()=>{
  const start=rust.indexOf("ToolAction::PremiereAssembly{assembly,apply}");
  const end=rust.indexOf("ToolAction::PremiereFinishMediaBatch",start);
  const arm=rust.slice(start,end);
  assert.match(arm,/let backup=backup_premiere_project\(&premiere_bridge\)\.await\?/);
  assert.match(arm,/let checkpoint=backup\.clone\(\)/);
});

test("review timestamps are bounded and delegated to existing review tool",()=>{
  assert.match(assembly,/MAX_REVIEW_TIMES: usize = 8/);
  assert.match(rust,/"review_execution_tool":if assembly\.review\{Some\("premiere_review_frames"\)\}/);
});

test("advanced assembly stops conservatively on mutating route errors",()=>{
  assert.match(rust,/uncertain=true;/);
  assert.match(rust,/"automatic_rollback":false/);
});


test("advanced assembly stops after an accepted but unverified transition",()=>{
  const start=rust.indexOf("ToolAction::PremiereAssembly{assembly,apply}");
  const end=rust.indexOf("ToolAction::PremiereFinishMediaBatch",start);
  const arm=rust.slice(start,end);
  assert.match(arm,/verificationStatus/);
  assert.match(arm,/"status":if verified \{"verified"\}else\{"accepted_unverified"\}/);
  assert.match(arm,/if !verified \{uncertain=true;break;\}/);
  assert.match(arm,/transition_results\.iter\(\)\.all\(\|row\|row\["status"\]=="verified"\)/);
});
