import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const uxp=readFileSync(new URL("../integrations/premiere-uxp/main.js",import.meta.url),"utf8");
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("simple Premiere state mutations require fresh native readback",()=>{
  const track=uxp.slice(uxp.indexOf("async function setTrackMute"),uxp.indexOf("async function setClipEnabled"));
  assert.match(track,/observedMuted/);
  assert.match(track,/verificationStatus: verified \? "verified_readback" : "accepted_unverified"/);

  const clip=uxp.slice(uxp.indexOf("async function setClipEnabled"),uxp.indexOf("async function listVideoTransitions"));
  assert.match(clip,/getVideoClipTarget|kind === "video"/);
  assert.match(clip,/isDisabled\(\)/);
  assert.match(clip,/observedEnabled === enabled/);

  const captionName=uxp.slice(uxp.indexOf("async function setCaptionTrackName"),uxp.indexOf("async function setCaptionTrackMute"));
  assert.match(captionName,/inspectedId = track\.id \?\? null/);
  assert.match(captionName,/observedName === name/);
  assert.match(captionName,/stableTrackIdentityAvailable/);

  const captionMute=uxp.slice(uxp.indexOf("async function setCaptionTrackMute"),uxp.indexOf("async function inspectAssemblyItems"));
  assert.match(captionMute,/observedMuted === muted/);
  assert.match(captionMute,/retrySafe: false/);
});

test("desktop refuses success when simple Premiere state readback is unverified",()=>{
  const pairs=[
    ["PremiereSetTrackMute","PremiereSetClipEnabled"],
    ["PremiereSetClipEnabled","PremiereAddVideoTransition"],
    ["PremiereSetCaptionTrackName","PremiereSetCaptionTrackMute"],
    ["PremiereSetCaptionTrackMute","PremiereSetPlayhead"]
  ];
  for(const [name,next] of pairs){
    const start=rust.lastIndexOf("ToolAction::"+name);
    const end=rust.indexOf("\n        ToolAction::"+next,start);
    const arm=rust.slice(start,end);
    assert.match(arm,/verified_readback/);
    assert.match(arm,/success: verified/);
    assert.match(arm,/retry_safe/);
  }
});

test("playhead movement and vision review require exact native position readback",()=>{
  const playhead=uxp.slice(uxp.indexOf("async function setPlayhead"),uxp.indexOf("async function setTrackMute"));
  assert.match(playhead,/getPlayerPosition\(\)/);
  assert.match(playhead,/Math\.abs\(observedSeconds-seconds\) <= 0\.001/);
  assert.match(playhead,/verificationStatus: verified \? "verified_readback" : "accepted_unverified"/);
  const directStart=rust.lastIndexOf("ToolAction::PremiereSetPlayhead");
  const directEnd=rust.indexOf("\n        ToolAction::PremiereInspectFrame",directStart);
  const direct=rust.slice(directStart,directEnd);
  assert.match(direct,/verified_readback/);
  assert.match(direct,/success: verified/);
  assert.match(rust,/playhead readback did not confirm the requested inspection frame/);
  assert.match(rust,/playhead readback did not confirm the requested review frame/);
  assert.match(rust,/playhead readback did not confirm the finishing review frame/);
  assert.match(rust,/playhead readback did not confirm the post-finishing review frame/);
  assert.match(rust,/playhead readback did not confirm the review-session frame/);
});


test("Premiere transition mutations require exact enumerated boundary readback",()=>{
  const add=uxp.slice(uxp.indexOf("async function addVideoTransition"),uxp.indexOf("function plainEffectValue"));
  assert.match(add,/snapshotVideoTransitions/);
  assert.match(add,/verificationStatus: verified \? "verified_transition" : "accepted_unverified"/);
  assert.match(add,/uncertain: !verified/);
  assert.match(add,/retrySafe: false/);
  const remove=uxp.slice(uxp.indexOf("async function removeVideoTransition"),uxp.indexOf("async function editKeyframe"));
  assert.match(remove,/snapshotVideoTransitions/);
  assert.match(remove,/verificationStatus: verified \? "verified_transition" : "accepted_unverified"/);
  assert.match(remove,/uncertain: !verified/);
  assert.match(remove,/retrySafe: false/);

  for(const [name,next] of [["PremiereRemoveVideoTransition","PremiereInspectKeyframes"],["PremiereAddVideoTransition","PremiereListVideoEffects"]]){
    const start=rust.lastIndexOf("ToolAction::"+name);
    const end=rust.indexOf("\n        ToolAction::"+next,start);
    const arm=rust.slice(start,end);
    assert.match(arm,/verified_transition/);
    assert.match(arm,/success: verified/);
    assert.match(arm,/"retry_safe":\s*false/);
  }
});


test("direct MOGRT insertion is success only after bounded before/after creation correlation",()=>{
  const helper=uxp.slice(uxp.indexOf("async function verifyDirectMogrtInsertion"),uxp.indexOf("async function insertMogrtFromPath"));
  assert.match(helper,/graphicsTrackSnapshot/);
  assert.match(helper,/graphicsAdditions/);
  assert.match(helper,/videoAdditions\.length === 1/);
  assert.match(helper,/observedStart\?\.ticks === requestedTime\.ticks/);
  assert.match(helper,/verificationStatus: verified \? "verified_creation_identity" : "accepted_unverified"/);
  assert.match(helper,/retrySafe: false/);

  for(const [name,next] of [["PremiereInsertMogrtPath","PremiereInsertMogrtLibrary"],["PremiereInsertMogrtLibrary","PremiereBatchRelink"]]){
    const start=rust.lastIndexOf("ToolAction::"+name);
    const end=rust.indexOf("\n        ToolAction::"+next,start);
    const arm=rust.slice(start,end);
    assert.match(arm,/verified_creation_identity/);
    assert.match(arm,/success: verified/);
    assert.match(arm,/"retry_safe":\s*false/);
  }
});


test("source in/out set requires independent bound readback while clear remains conservative",()=>{
  const set=uxp.slice(uxp.indexOf("async function setSourceInOut"),uxp.indexOf("async function clearSourceInOut"));
  assert.match(set,/const before=await readSourceInOut\(clip\)/);
  assert.match(set,/const after=await readSourceInOut\(fresh\.clip\)/);
  assert.match(set,/verificationStatus: verified \? "verified_source_inout" : "accepted_unverified"/);
  assert.match(set,/uncertain: !verified/);
  assert.match(set,/retrySafe: false/);
  const clear=uxp.slice(uxp.indexOf("async function clearSourceInOut"),uxp.indexOf("async function collectProjectItemsForCorrelation"));
  assert.match(clear,/verificationStatus: "accepted_unverified"/);
  assert.match(clear,/uncertain: true/);
  assert.match(clear,/retrySafe: false/);

  for(const [name,next] of [["PremiereSetSourceInOut","PremiereClearSourceInOut"],["PremiereClearSourceInOut","PremiereCreateSubclip"]]){
    const start=rust.lastIndexOf("ToolAction::"+name);
    const end=rust.indexOf("\n        ToolAction::"+next,start);
    const arm=rust.slice(start,end);
    assert.match(arm,/verified_source_inout/);
    assert.match(arm,/success: verified/);
    assert.match(arm,/"retry_safe": false/);
  }
});

test("Premiere project save does not promote host acceptance to verified persistence",()=>{
  const save=uxp.slice(uxp.indexOf("async function saveProject"),uxp.indexOf("async function sortedClipItems"));
  assert.match(save,/verificationStatus: "accepted_unverified"/);
  assert.match(save,/persistenceVerified: false/);
  assert.match(save,/uncertain: true/);
  assert.match(save,/retrySafe: false/);

  const start=rust.lastIndexOf("ToolAction::PremiereSaveProject");
  const end=rust.indexOf("\n        ToolAction::AfterEffectsCapabilityReport",start);
  const arm=rust.slice(start,end);
  assert.match(arm,/persistence_verified/);
  assert.match(arm,/verified_file_persistence/);
  assert.match(arm,/success: verified/);
  assert.match(arm,/"retry_safe":\s*false/);
  assert.doesNotMatch(arm,/success: true/);
});

test("timeline inspection exposes media identity needed for independent ripple-delete verification",()=>{
  const summarize=uxp.slice(uxp.indexOf("async function summarizeTrackItem"),uxp.indexOf("async function timelineCapabilities"));
  assert.match(summarize,/mediaId = await projectItemId\(await item\.getProjectItem\(\)\)/);
  assert.match(summarize,/mediaId,/);
});
