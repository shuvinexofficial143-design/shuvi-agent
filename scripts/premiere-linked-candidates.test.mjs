import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const uxp=readFileSync(new URL("../integrations/premiere-uxp/main.js",import.meta.url),"utf8");
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const acceptance=readFileSync(new URL("../src-tauri/src/premiere_acceptance.rs",import.meta.url),"utf8");

test("linked clip audit never promotes media/timing candidates to native membership",()=>{
  const body=uxp.slice(uxp.indexOf("async function inspectLinkedCandidates"),uxp.indexOf("async function timelineCapabilities"));
  assert.match(body,/same_project_item_plus_exact_source_or_timeline_ticks/);
  assert.match(body,/nativeLinkGetterAvailable:false/);
  assert.match(body,/membershipVerified:false/);
  assert.match(body,/safeForAutomaticLinkedEdit:false/);
  assert.match(body,/candidateCount/);
  assert.doesNotMatch(body,/executeTransaction|createMoveAction|createRemoveItemsAction/);
  assert.match(rust,/premiere_inspect_linked_candidates/);
  assert.match(acceptance,/"native_linked_group_membership":\{"state":"unsupported_documented"/);
});
