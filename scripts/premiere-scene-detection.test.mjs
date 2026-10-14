import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const scene=readFileSync(new URL("../src-tauri/src/premiere_scene_detection.rs",import.meta.url),"utf8");
const uxp=readFileSync(new URL("../integrations/premiere-uxp/main.js",import.meta.url),"utf8");

test("AB registers plan and separate marker/cut execution tools",()=>{
  assert.match(rust,/- premiere_plan_scene_detection:/);
  assert.match(rust,/- premiere_detect_scene_markers:/);
  assert.match(rust,/- premiere_detect_scene_cuts:/);
  assert.match(rust,/PremierePlanSceneDetection/);
  assert.match(rust,/PremiereSceneDetection/);
});

test("AB uses only documented stable SequenceOperation constants",()=>{
  assert.match(uxp,/SequenceOperation\.APPLYCUT/);
  assert.match(uxp,/SequenceOperation\.CREATEMARKER/);
  assert.match(uxp,/performSceneEditDetectionOnSelection/);
  assert.doesNotMatch(uxp,/sceneDetection.*["']cut["']/i);
});

test("AB bounds scene detection to explicit video targets",()=>{
  assert.match(scene,/MAX_TARGETS: usize = 16/);
  assert.match(scene,/1–16 explicit video targets/);
  assert.match(uxp,/Scene detection requires 1–16 exact video targets/);
  assert.match(uxp,/kind: "video"/);
});

test("AB extends target expectation coverage to every selected clip",()=>{
  assert.match(uxp,/command\.action === "scene_edit_detection"/);
  assert.match(uxp,/clipIndex: target\.clip_index \?\? target\.clipIndex/);
  assert.match(rust,/one exact video expectation for every explicit target/);
});

test("AB temporarily sets exact selection and requires restoration for overall success",()=>{
  assert.match(uxp,/replaceSequenceSelection\(sequence, resolved\.map\(entry => entry\.item\)\)/);
  assert.match(uxp,/previousSelection = await sequence\.getSelection\(\)/);
  assert.match(uxp,/selectionRestored = \(await replaceSequenceSelection\(sequence, previousItems\)\) !== false/);
  const start=rust.indexOf("ToolAction::PremiereSceneDetection {request} =>");
  const arm=rust.slice(start,rust.indexOf("\n        ToolAction::PremiereCancelTranscriptRebuild",start));
  assert.match(arm,/verified = delta_verified && selection_restored/);
});

test("AB observes both sequence and source marker deltas",()=>{
  assert.match(uxp,/markerRowsForOwner\(sequence, "sequence"/);
  assert.match(uxp,/sourceMarkerSnapshot\(resolved\)/);
  assert.match(uxp,/newSequenceMarkers/);
  assert.match(uxp,/newSourceMarkers/);
  assert.match(uxp,/markerDelta/);
});

test("source markers map to sequence time only for proven 1x targets",()=>{
  assert.match(uxp,/Math\.abs\(\(original\.speed \?\? 1\) - 1\) <= 0\.0001/);
  assert.match(uxp,/original\.startSeconds \+ \(row\.startSeconds - original\.sourceInSeconds\)/);
});

test("cut verification correlates same media on original track/range",()=>{
  assert.match(uxp,/sceneSegmentsAfter/);
  assert.match(uxp,/mediaId !== original\.mediaId/);
  assert.match(uxp,/Scene detection produced more than 256 bounded segments/);
});

test("native true without observable delta is not called verified or successful",()=>{
  assert.match(uxp,/"accepted_unverified"/);
  assert.match(uxp,/"verified_delta"/);
  const start=rust.indexOf("ToolAction::PremiereSceneDetection {request} =>");
  const arm=rust.slice(start,rust.indexOf("\n        ToolAction::PremiereCancelTranscriptRebuild",start));
  assert.match(arm,/delta_verified = verification == "verified_delta"/);
  assert.match(arm,/selection_restored = result\.get\("selectionRestored"\)/);
  assert.match(arm,/verified = delta_verified && selection_restored/);
  assert.match(arm,/success:verified/);
  assert.match(arm,/"post_state_verified":delta_verified/);
  assert.match(arm,/"selection_restored":selection_restored/);
  assert.match(arm,/"uncertain":accepted&&!verified/);
  assert.match(arm,/"runtime_verified":false/);
});

test("AB checkpoints mutation and never marks retry safe",()=>{
  const start=rust.indexOf("ToolAction::PremiereSceneDetection {request} =>");
  const arm=rust.slice(start,rust.indexOf("\n        ToolAction::PremiereCancelTranscriptRebuild",start));
  assert.match(arm,/backup_premiere_project\(&premiere_bridge\)\.await\?/);
  assert.match(arm,/"retry_safe":false/);
  assert.match(scene,/"blind_retry":false/);
});

test("AB scene review timestamps are bounded",()=>{
  assert.match(uxp,/segments\.slice\(0,8\)/);
  assert.match(uxp,/reviewTimes/);
});
