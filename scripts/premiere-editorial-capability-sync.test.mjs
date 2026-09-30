import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/premiere_editorial.rs",import.meta.url),"utf8");

test("editorial planner no longer globally blocks source-safe vertical track moves",()=>{
  assert.match(rust,/"vertical_move"=>"premiere_move_clip_to_track"/);
  assert.match(rust,/stage_type:"vertical_move"/);
  assert.match(rust,/id:"vertical_track_moves"/);
  assert.match(rust,/clone verification and source non-ripple delete/);
  assert.doesNotMatch(rust,/\("vertical_track_moves","Vertical track moves are unsupported\."\)/);
});

test("editorial caption wording preserves import-vs-native-write boundary",()=>{
  assert.match(rust,/Verified \.srt\/\.vtt project-item import is available separately/);
  assert.match(rust,/native caption cue\/text track creation\/editing remains unsupported/);
  assert.match(rust,/native caption cue\/text writes/);
  assert.doesNotMatch(rust,/Native caption creation\/import is unverified/);
});

test("speed masks and multicam option wording remains capability-specific",()=>{
  assert.match(rust,/Native speed\/time-remapping writes are unsupported; inspected read\/planning remains available/);
  assert.match(rust,/Native mask creation\/editing is unsupported; bounded presence inspection remains available/);
  assert.match(rust,/Native multicam creation\/angle switching is unsupported; existing verified multicam project-item insertion is separate/);
});
