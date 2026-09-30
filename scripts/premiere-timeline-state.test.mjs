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
