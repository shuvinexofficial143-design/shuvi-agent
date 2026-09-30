import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const uxp=readFileSync(new URL("../integrations/premiere-uxp/main.js",import.meta.url),"utf8");

test("transition readback enumerates native TRANSITION track items within a bound",()=>{
  const body=uxp.slice(uxp.indexOf("async function snapshotVideoTransitions"),uxp.indexOf("async function addVideoTransition"));
  assert.match(body,/TrackItemType\?\.TRANSITION/);
  assert.match(body,/track\.getTrackItems\(transitionType,false\)/);
  assert.match(body,/native\.length>1024/);
  assert.match(body,/getStartTime/);
  assert.match(body,/getEndTime/);
  assert.match(body,/getMatchName/);
  assert.match(body,/scanComplete:false/);
});

test("transition add verifies only exact new boundary-correlated native item",()=>{
  const body=uxp.slice(uxp.indexOf("async function addVideoTransition"),uxp.indexOf("function plainEffectValue"));
  assert.match(body,/const beforeTransitions=await snapshotVideoTransitions\(track\)/);
  assert.match(body,/const afterTransitions=await snapshotVideoTransitions\(track\)/);
  assert.match(body,/transitionMultisetDelta\(beforeTransitions\.items,afterTransitions\.items\)/);
  assert.match(body,/boundaryMatches\.length===1&&boundaryMatches\[0\]\.matchName===matchName/);
  assert.match(body,/verificationStatus: verified \? "verified_transition" : "accepted_unverified"/);
  assert.match(body,/retrySafe: false/);
});

test("transition removal requires one exact boundary delta and no remaining boundary transition",()=>{
  const body=uxp.slice(uxp.indexOf("async function removeVideoTransition"),uxp.indexOf("async function editKeyframe"));
  assert.match(body,/const beforeTransitions=await snapshotVideoTransitions\(videoTrack\)/);
  assert.match(body,/transitionMultisetDelta\(afterTransitions\.items,beforeTransitions\.items\)/);
  assert.match(body,/beforeBoundary\.length===1&&removedBoundary\.length===1&&afterBoundary\.length===0/);
  assert.match(body,/verificationStatus: verified \? "verified_transition" : "accepted_unverified"/);
  assert.doesNotMatch(body,/retrySafe: true/);
});
