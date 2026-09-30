import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const uxp=readFileSync(new URL("../integrations/premiere-uxp/main.js",import.meta.url),"utf8");

test("track rename uses native TrackGroup id only as a stale-target guard",()=>{
  const body=uxp.slice(uxp.indexOf("async function renameTrack"),uxp.indexOf("async function organizeTracks"));
  assert.match(body,/inspectedNativeId = Number\.isFinite\(track\.id\)/);
  assert.match(body,/freshTrack\.id!==inspectedNativeId/);
  assert.match(body,/after\.id===inspectedNativeId/);
  assert.match(body,/nativeTrackGroupIdScope:"track_group"/);
  assert.match(body,/stableTrackIdentityAvailable:false/);
  assert.match(body,/stableTrackUuidAvailable:false/);
});

test("multi-track organization rechecks each native group id before and after mutation",()=>{
  const body=uxp.slice(uxp.indexOf("async function organizeTracks"),uxp.indexOf("async function resolveNamedVideoParam"));
  assert.match(body,/inspectedNativeId:Number\.isFinite\(track\.id\)\?track\.id:null/);
  assert.match(body,/freshTrack\.id!==entry\.inspectedNativeId/);
  assert.match(body,/current\.id===entry\.inspectedNativeId/);
  assert.match(body,/stableTrackUuidAvailable:false/);
  assert.doesNotMatch(body,/trackUuid/);
});
