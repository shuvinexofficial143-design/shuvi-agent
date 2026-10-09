import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const uxp=readFileSync(new URL("../integrations/premiere-uxp/main.js",import.meta.url),"utf8");
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("trim and move recheck inspected targets and verify native timing readback",()=>{
  const trim=uxp.slice(uxp.indexOf("async function trimClip"),uxp.indexOf("async function moveClip"));
  assert.match(trim,/assertResolvedClipMatchesActiveExpectation/);
  assert.match(trim,/Requested trim is a no-op/);
  assert.match(trim,/observedMediaId === beforeMediaId/);
  assert.match(trim,/closeTimelineSeconds\(observedStart,nextStart\)/);
  assert.match(trim,/verificationStatus: verified \? "verified_readback" : "accepted_unverified"/);

  const move=uxp.slice(uxp.indexOf("async function moveClip"),uxp.indexOf("async function deleteClip"));
  assert.match(move,/assertResolvedClipMatchesActiveExpectation/);
  assert.match(move,/nextEnd = beforeEndSeconds \+ deltaSeconds/);
  assert.match(move,/observedMediaId === beforeMediaId/);
  assert.match(move,/closeTimelineSeconds\(observedEnd,nextEnd\)/);
  assert.match(move,/retrySafe: false/);
});

test("roll edit requires one real boundary and verifies both clips after mutation",()=>{
  const roll=uxp.slice(uxp.indexOf("async function rollEdit"),uxp.indexOf("async function requireClipProjectItemById"));
  assert.match(roll,/Roll edit requires clips that share one inspected boundary/);
  assert.match(roll,/Requested roll edit is a no-op/);
  assert.match(roll,/assertResolvedClipMatchesActiveExpectation\(project,sequence,left/);
  assert.match(roll,/assertResolvedClipMatchesActiveExpectation\(project,sequence,right/);
  assert.match(roll,/observedLeftMediaId === leftMediaId/);
  assert.match(roll,/observedRightMediaId === rightMediaId/);
  assert.match(roll,/closeTimelineSeconds\(observedLeftEnd,boundarySeconds\)/);
  assert.match(roll,/closeTimelineSeconds\(observedRightStart,boundarySeconds\)/);
});

test("desktop core timeline tools refuse accepted-unverified results",()=>{
  const pairs=[
    ["PremiereTrimClip","PremiereRollEdit"],
    ["PremiereRollEdit","PremiereMoveClip"],
    ["PremiereMoveClip","PremiereCloneClip"]
  ];
  for(const [name,next] of pairs){
    const start=rust.indexOf("ToolAction::"+name+" {",500000);
    const end=rust.indexOf("\n        ToolAction::"+next,start+10);
    const arm=rust.slice(start,end);
    assert.match(arm,/verified_readback/);
    assert.match(arm,/success: verified/);
    assert.match(arm,/retry_safe/);
  }
});


test("clone requires an exact +1 media/time delta before success",()=>{
  const clone=uxp.slice(uxp.indexOf("async function cloneClip"),uxp.indexOf("async function snapshotTrackItems"));
  assert.match(clone,/beforeDestination = await snapshotTrackItems/);
  assert.match(clone,/assertResolvedClipMatchesActiveExpectation/);
  assert.match(clone,/zero-displacement clone is ambiguous/);
  assert.match(clone,/afterDestination\.length === beforeDestination\.length \+ 1/);
  assert.match(clone,/candidates\.length === 1/);
  assert.match(clone,/verificationStatus: verified \? "verified_delta" : "accepted_unverified"/);
});

test("delete verifies the exact expected track row set including ripple shift",()=>{
  const del=uxp.slice(uxp.indexOf("async function deleteClip"),uxp.indexOf("function capabilityEvidence"));
  assert.match(del,/beforeRows = await snapshotTrackItems/);
  assert.match(del,/Delete verification requires a non-overlapping target/);
  assert.match(del,/expectedRowsAfterDelete/);
  assert.match(del,/timelineRowsMatchExpected/);
  assert.match(del,/verificationStatus: verified \? "verified_delta" : "accepted_unverified"/);
  assert.match(uxp,/Track snapshot exceeds the 1,000-clip correlation bound/);
});

test("desktop clone and delete refuse unverified native deltas",()=>{
  for(const [name,next] of [["PremiereCloneClip","PremiereDeleteClip"],["PremiereDeleteClip","PremiereSetTrackMute"]]){
    const start=rust.indexOf("ToolAction::"+name+" {",500000);
    const end=rust.indexOf("\n        ToolAction::"+next,start+10);
    const arm=rust.slice(start,end);
    assert.match(arm,/verified_delta/);
    assert.match(arm,/success: verified/);
    assert.match(arm,/retry_safe/);
  }
});


test("project-item and media insertion verify exact insert deltas and keep overwrite unverified",()=>{
  const project=uxp.slice(uxp.indexOf("async function insertProjectItem"),uxp.indexOf("async function resolveKeyframeTarget"));
  const media=uxp.slice(uxp.indexOf("async function insertMedia"),uxp.indexOf("function closeTimelineSeconds"));
  for(const body of [project,media]){
    assert.match(body,/snapshotInsertionTracks/);
    assert.match(body,/insertionVerification/);
    assert.match(body,/verified_insert_delta/);
    assert.match(body,/overwriteSemanticsVerified:false/);
    assert.match(body,/retrySafe:false/);
  }
  const helper=uxp.slice(uxp.indexOf("async function snapshotInsertionTracks"),uxp.indexOf("async function insertProjectItem"));
  assert.match(helper,/mode === "insert"/);
  assert.match(helper,/mode === "overwrite"/);
  assert.match(helper,/overwritten-range semantics are not fully verified/);
});

test("desktop insertion tools refuse overwrite or otherwise unverified semantics",()=>{
  for(const [name,next] of [["PremiereInsertProjectItem","PremiereInsertMedia"],["PremiereInsertMedia","PremiereTrimClip"]]){
    const start=rust.indexOf("ToolAction::"+name+" {",500000);
    const end=rust.indexOf("\n        ToolAction::"+next,start+10);
    const arm=rust.slice(start,end);
    assert.match(arm,/verified_insert_delta/);
    assert.match(arm,/success: verified/);
    assert.match(arm,/overwrite_semantics_verified/);
  }
});
