import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const uxp=readFileSync(new URL("../integrations/premiere-uxp/main.js",import.meta.url),"utf8");
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("subclip creation verifies exact new item plus requested source bounds and media selection",()=>{
  const body=uxp.slice(uxp.indexOf("async function createSubclip"),uxp.indexOf("async function transcribeItem"));
  assert.match(body,/candidates\.length === 1/);
  assert.match(body,/sourceReadback=await readSourceInOut\(createdClip\)/);
  assert.match(body,/Math\.abs\(row\.inSeconds-startSeconds\)<=0\.001/);
  assert.match(body,/Math\.abs\(row\.outSeconds-endSeconds\)<=0\.001/);
  assert.match(body,/Boolean\(byType\.has\("video"\)\)===takeVideo/);
  assert.match(body,/Boolean\(byType\.has\("audio"\)\)===takeAudio/);
  assert.match(body,/hardBoundaryModeVerified:false/);
  assert.match(body,/verificationStatus: verified \? "verified_creation_identity" : "accepted_unverified"/);
});

test("desktop does not report subclip success without bound and media evidence",()=>{
  const last=rust.lastIndexOf("ToolAction::PremiereCreateSubclip");
  const end=rust.indexOf("ToolAction::PremiereTranscribeItem",last);
  const arm=rust.slice(last,end);
  assert.match(arm,/boundarySemanticsVerified/);
  assert.match(arm,/mediaSelectionVerified/);
  assert.match(arm,/&&bounds_verified&&media_verified/);
  assert.match(arm,/"hard_boundary_mode_verified":false/);
  assert.match(arm,/success: verified/);
});
