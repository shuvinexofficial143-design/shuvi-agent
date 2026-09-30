import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const uxp=readFileSync(new URL("../integrations/premiere-uxp/main.js",import.meta.url),"utf8");
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const acceptance=readFileSync(new URL("../src-tauri/src/premiere_acceptance.rs",import.meta.url),"utf8");

test("existing multicam items are identity-verified before typed insertion",()=>{
  const inspect=uxp.slice(uxp.indexOf("async function inspectMulticamItem"),uxp.indexOf("async function insertMulticamItem"));
  const insert=uxp.slice(uxp.indexOf("async function insertMulticamItem"),uxp.indexOf("async function insertProjectItem"));
  assert.match(inspect,/clip\.isMulticamClip/);
  assert.match(inspect,/creationSupported:false/);
  assert.match(inspect,/switchingSupported:false/);
  assert.match(insert,/await inspectMulticamItem/);
  assert.match(insert,/await insertProjectItem/);
  assert.match(insert,/verified_multicam_insert/);
  assert.match(rust,/premiere_inspect_multicam_item/);
  assert.match(rust,/premiere_insert_multicam_item/);
  assert.match(acceptance,/"multicam_creation_switching":\{"state":"unsupported_documented"/);
});
