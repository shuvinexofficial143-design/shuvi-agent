import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {commandPlan} from "./run-attested.mjs";

test("BUG-025: exact-HEAD frontend and full attestation cannot skip dashboard regression suite",()=>{
 for(const scope of ["frontend","full"]){
  const commands=commandPlan(scope).map(x=>x.name);
  assert.deepEqual(commands.slice(0,4),["validate","node_tests","dashboard_tests","frontend_build"]);
  const dashboard=commandPlan(scope).find(x=>x.name==="dashboard_tests");
  assert.deepEqual(dashboard.args,["--prefix","web-dashboard","test"]);
 }
 const ci=readFileSync(new URL("../.github/workflows/ci.yml",import.meta.url),"utf8");
 assert.match(ci,/npm run verify:frontend/);
 assert.match(ci,/npm run verify:rust/);
 assert.match(ci,/npm run build:windows-installer/);
});
test("BUG-016: manual installer must use same SHA-pinned path and immutable real-NSIS evidence as main CI",()=>{
 const file=readFileSync(new URL("../.github/workflows/windows-installer.yml",import.meta.url),"utf8");
 assert.match(file,/workflow_dispatch/);
 assert.match(file,/npm run verify:full/);
 assert.match(file,/npm run build:windows-installer/);
 assert.match(file,/windows-m62-real-nsis-install-acceptance\.mjs/);
 assert.match(file,/Get-FileHash/);
 assert.match(file,/manifest\.installerSha256/);
 assert.match(file,/SHUVI62-UNSIGNED-PINNED-TEST-INSTALLER/);
 assert.doesNotMatch(file,/npx tauri build|run:\s*tauri build/);
 assert.doesNotMatch(file,/actions\/upload-release-asset|gh release create/);
});
