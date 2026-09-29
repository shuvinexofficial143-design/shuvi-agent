import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");

test("path-bearing session permissions are exact-path only",()=>{
  const start=main.indexOf("function sessionPermissionKey");
  const end=main.indexOf("function sessionPermissionLabel",start);
  const block=main.slice(start,end);
  assert.match(block,/return proposal\.tool \+ "\|exact:" \+ normalizeScopePath\(pathValue\)/);
  assert.doesNotMatch(block,/normalizedWorkspace/);
  assert.doesNotMatch(block,/startsWith\(normalizedWorkspace/);
  assert.doesNotMatch(block,/\|workspace:/);
  assert.match(block,/junctions and symlinks/);
});

test("session permission UI describes exact path scope",()=>{
  const start=main.indexOf("function sessionPermissionLabel");
  const end=main.indexOf("function hiddenToolFailure",start);
  const block=main.slice(start,end);
  assert.match(block,/Allow this exact path for session/);
  assert.doesNotMatch(block,/Allow in this workspace for session/);
});
