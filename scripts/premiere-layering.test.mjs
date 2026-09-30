import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const layering=readFileSync(new URL("../src-tauri/src/premiere_layering.rs",import.meta.url),"utf8");
const uxp=readFileSync(new URL("../integrations/premiere-uxp/main.js",import.meta.url),"utf8");

test("AC exposes cross-track clone, batch layering and track organization tools",()=>{
  for(const name of [
    "premiere_clone_clip_to_track","premiere_layer_clips","premiere_cancel_layer_clips",
    "premiere_rename_track","premiere_organize_tracks"
  ]) assert.match(rust,new RegExp(name));
});

test("cross-track clone uses documented native clone action",()=>{
  assert.match(uxp,/createCloneTrackItemAction/);
  assert.match(uxp,/videoTrackVerticalOffset/);
  assert.match(uxp,/audioTrackVerticalOffset/);
  assert.match(uxp,/destinationTrack-sourceTrack/);
});

test("clone destination is explicit existing and clear",()=>{
  assert.match(uxp,/destinationTrack === sourceTrack/);
  assert.match(uxp,/requires existing source and destination tracks/);
  assert.match(uxp,/destination range is occupied/);
  assert.match(uxp,/clearDestinationRequired:true/);
});

test("cross-track clone revalidates source and destination immediately before dispatch",()=>{
  const clone=uxp.slice(uxp.indexOf("async function cloneClipToTrack"),uxp.indexOf("async function resolveTrackByKind"));
  assert.match(clone,/freshSourceItems/);
  assert.match(clone,/freshSourceSignature !== expectedSource\.signature/);
  assert.match(clone,/preDispatchDestination = await snapshotTrackItems/);
  assert.match(clone,/destinationState\(preDispatchDestination\) !== destinationState\(before\)/);
  assert.match(clone,/destination changed during preflight/);
  assert.match(clone,/new Set\(preDispatchDestination\.map/);
});

test("post clone correlation requires exact same media time and duration",()=>{
  assert.match(uxp,/row\.mediaId === mediaId/);
  assert.match(uxp,/Math\.abs\(row\.startSeconds-destinationSeconds\)/);
  assert.match(uxp,/Math\.abs\(row\.durationSeconds-durationSeconds\)/);
  assert.match(uxp,/verificationStatus:verified \? "verified_delta" : "accepted_unverified"/);
});

test("linked media membership is never inferred",()=>{
  assert.match(uxp,/linkedMediaInferred:false/);
  assert.match(rust,/"linked_media_inferred":false/);
});

test("layer batch is bounded, unique and cancellable",()=>{
  assert.match(layering,/MAX_LAYER_OPS: usize = 32/);
  assert.match(layering,/1–32 explicit clone operations/);
  assert.match(rust,/layering_cancelled/);
  assert.match(rust,/PremiereCancelLayerClips/);
  assert.match(rust,/if state\.layering_cancelled\.load/);
});

test("batch takes one checkpoint and per-source stale guards",()=>{
  const arm=rust.slice(rust.indexOf("ToolAction::PremiereLayerClips"));
  assert.match(arm,/backup_premiere_project\(&premiere_bridge\)\.await\?/);
  assert.match(arm,/clips:vec!\[clip\]/);
  assert.match(arm,/PremiereClient/);
});

test("track rename supports documented existing video audio caption tracks",()=>{
  assert.match(layering,/"video" \| "audio" \| "caption"/);
  assert.match(uxp,/createSetNameAction/);
  assert.match(uxp,/Native track rename requires Premiere 26\.3\+/);
});

test("track organization is one bounded compound transaction with readback",()=>{
  assert.match(layering,/MAX_TRACK_RENAMES: usize = 32/);
  assert.match(uxp,/Shuvi: Organize Tracks/);
  assert.match(uxp,/for \(const entry of resolved\) compoundAction\.addAction/);
  assert.match(uxp,/complete:results\.every\(row => row\.verified\)/);
});

test("AC never claims retry safety after native mutation",()=>{
  assert.match(uxp,/retrySafe:false/);
  assert.match(rust,/"retry_safe":false/);
});
