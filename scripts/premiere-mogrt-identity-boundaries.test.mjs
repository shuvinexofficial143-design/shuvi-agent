import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const uxp=readFileSync(new URL("../integrations/premiere-uxp/main.js",import.meta.url),"utf8");

test("direct MOGRT verification separates inserted clip identity from template semantics",()=>{
  const body=uxp.slice(
    uxp.indexOf("async function verifyDirectMogrtInsertion"),
    uxp.indexOf("async function insertMogrtFromPath")
  );
  assert.match(body,/insertedClipIdentityVerified:verified/);
  assert.match(body,/templateSourceIdentityVerified:false/);
  assert.match(body,/thirdPartySemanticIdentityVerified:false/);
  assert.match(body,/verificationStatus: verified \? "verified_creation_identity" : "accepted_unverified"/);
});

test("path and library insertion surface the same conservative identity boundary",()=>{
  for(const [start,end] of [
    ["async function insertMogrtFromPath","async function insertMogrtFromLibrary"],
    ["async function insertMogrtFromLibrary","async function cloneClip"]
  ]){
    const body=uxp.slice(uxp.indexOf(start),uxp.indexOf(end));
    assert.match(body,/insertedClipIdentityVerified:verification\.insertedClipIdentityVerified/);
    assert.match(body,/templateSourceIdentityVerified:false/);
    assert.match(body,/thirdPartySemanticIdentityVerified:false/);
    assert.doesNotMatch(body,/templateSourceIdentityVerified:true/);
    assert.doesNotMatch(body,/thirdPartySemanticIdentityVerified:true/);
  }
});
