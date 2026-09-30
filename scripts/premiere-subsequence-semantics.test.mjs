import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const uxp=readFileSync(new URL("../integrations/premiere-uxp/main.js",import.meta.url),"utf8");
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("subsequence verifies selected-only clip inventory timing and source ranges",()=>{
  const create=uxp.slice(uxp.indexOf("async function createSubsequence"),uxp.indexOf("async function sequenceClipContent"));
  assert.match(create,/requestedContent/);
  assert.match(create,/getStartTime\(\),entry\.item\.getEndTime\(\),entry\.item\.getInPoint\(\),entry\.item\.getOutPoint\(\)/);
  assert.match(create,/selectionSemanticsVerified=requestedNormalized\.length===observedNormalized\.length/);
  assert.match(create,/relativeStartMs/);
  assert.match(create,/sourceInMs/);
  assert.match(create,/sourceOutMs/);
  assert.match(create,/sequenceIdentityVerified && projectItemResolved && selectionRestored && selectionSemanticsVerified/);
});

test("nested sequence content inspection is bounded and includes source in-out",()=>{
  const body=uxp.slice(uxp.indexOf("async function sequenceClipContent"),uxp.indexOf("async function replaceWithSubsequence"));
  assert.match(body,/let budget = 64/);
  assert.match(body,/item\.getInPoint\(\)/);
  assert.match(body,/item\.getOutPoint\(\)/);
  assert.match(body,/sourceInSeconds/);
  assert.match(body,/sourceOutSeconds/);
  assert.match(body,/track count exceeds the verification bound/);
});

test("desktop refuses creation-only success when selected content semantics are absent",()=>{
  const last=rust.lastIndexOf("ToolAction::PremiereCreateSubsequence");
  const end=rust.indexOf("ToolAction::PremiereInspectMulticamItem",last);
  const arm=rust.slice(last,end);
  assert.match(arm,/selectionSemanticsVerified/);
  assert.match(arm,/&&content_verified/);
  assert.match(arm,/"selection_semantics_verified":content_verified/);
  assert.match(arm,/success: verified/);
});
