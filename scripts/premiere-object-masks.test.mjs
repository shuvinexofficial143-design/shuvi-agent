import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const uxp=readFileSync(new URL("../integrations/premiere-uxp/main.js",import.meta.url),"utf8");
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const acceptance=readFileSync(new URL("../src-tauri/src/premiere_acceptance.rs",import.meta.url),"utf8");

test("object mask support is bounded read-only presence inspection",()=>{
  const body=uxp.slice(uxp.indexOf("async function inspectObjectMasks"),uxp.indexOf("async function captionTracks"));
  assert.match(body,/ObjectMaskUtils\.hasObjectMask\(project\)/);
  assert.match(body,/ObjectMaskUtils\.hasObjectMask\(sequence\)/);
  assert.match(body,/writeSupported:false/);
  assert.match(body,/inspectionVerified/);
  assert.doesNotMatch(body,/create.*Mask|executeTransaction/);
  assert.match(rust,/premiere_inspect_object_masks/);
  assert.match(rust,/PremiereInspectObjectMasks/);
  assert.match(acceptance,/"mask_creation_editing":\{"state":"unsupported_documented"/);
});
