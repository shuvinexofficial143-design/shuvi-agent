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
