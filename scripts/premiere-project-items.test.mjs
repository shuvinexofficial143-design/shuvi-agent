import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const uxp=readFileSync(new URL("../integrations/premiere-uxp/main.js",import.meta.url),"utf8");
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("bin creation rejects duplicate names and correlates one new exact folder id",()=>{
  const body=uxp.slice(uxp.indexOf("async function createBin"),uxp.indexOf("async function importMedia"));
  assert.match(body,/root Premiere bin with this exact name already exists/);
  assert.match(body,/beforeIds/);
  assert.match(body,/createdBinId/);
  assert.match(body,/candidates\.length === 1/);
  assert.match(body,/verified_readback/);
});

test("project item rename re-resolves exact id and verifies observed name",()=>{
  const body=uxp.slice(uxp.indexOf("async function renameProjectItem"),uxp.indexOf("async function moveProjectItem"));
  assert.match(body,/Requested project-item rename is a no-op/);
  assert.match(body,/freshItem = await findProjectItemById/);
  assert.match(body,/freshItem\?\.name !== previousName/);
  assert.match(body,/observedName === name/);
});

test("project item move binds source parent and destination identities then verifies parent",()=>{
  const body=uxp.slice(uxp.indexOf("async function moveProjectItem"),uxp.indexOf("async function relinkMedia"));
  assert.match(body,/sourceParentId/);
  assert.match(body,/Requested project-item move is a no-op/);
  assert.match(body,/freshSourceParent/);
  assert.match(body,/observedParentId === targetBinId/);
  assert.match(body,/retrySafe: false/);
});

test("desktop project-item mutations require verified readback",()=>{
  const pairs=[
    ["PremiereCreateBin","PremiereRenameProjectItem"],
    ["PremiereRenameProjectItem","PremiereMoveProjectItem"],
    ["PremiereMoveProjectItem","PremiereRelinkMedia"]
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
