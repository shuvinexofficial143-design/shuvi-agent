import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const uxp=readFileSync(new URL("../integrations/premiere-uxp/main.js",import.meta.url),"utf8");
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("source in-out reads documented media-specific bounds before and after set",()=>{
  const helper=uxp.slice(uxp.indexOf("async function readSourceInOut"),uxp.indexOf("async function setSourceInOut"));
  assert.match(helper,/MediaType\?\.VIDEO/);
  assert.match(helper,/MediaType\?\.AUDIO/);
  assert.match(helper,/MediaType\?\.DATA/);
  assert.match(helper,/clip\.getInPoint\(mediaType\)/);
  assert.match(helper,/clip\.getOutPoint\(mediaType\)/);
  const body=uxp.slice(uxp.indexOf("async function setSourceInOut"),uxp.indexOf("async function clearSourceInOut"));
  assert.match(body,/const before=await readSourceInOut\(clip\)/);
  assert.match(body,/const fresh=await requireClipProjectItemById\(itemId\)/);
  assert.match(body,/const after=await readSourceInOut\(fresh\.clip\)/);
  assert.match(body,/verificationStatus: verified \? "verified_source_inout" : "accepted_unverified"/);
  assert.match(body,/required\.size>0/);
  assert.match(body,/retrySafe: false/);
});

test("desktop already requires verified source in-out instead of treating acceptance as success",()=>{
  const last=rust.lastIndexOf("ToolAction::PremiereSetSourceInOut");
  const end=rust.indexOf("ToolAction::PremiereClearSourceInOut",last);
  const arm=rust.slice(last,end);
  assert.match(arm,/verificationStatus/);
  assert.match(arm,/verified_source_inout/);
  assert.match(arm,/success: verified/);
  assert.match(arm,/retry_safe": false/);
});

test("clear source in-out remains accepted-unverified without a documented cleared-state getter",()=>{
  const body=uxp.slice(uxp.indexOf("async function clearSourceInOut"),uxp.indexOf("async function collectProjectItemsForCorrelation"));
  assert.match(body,/verificationStatus: "accepted_unverified"/);
  assert.match(body,/retrySafe: false/);
  assert.doesNotMatch(body,/verified_source_inout/);
});
