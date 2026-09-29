import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const workflow=readFileSync(new URL("../.github/workflows/windows-installer.yml",import.meta.url),"utf8");

test("Windows installer uses the committed Node lockfile",()=>{
  assert.match(workflow,/run: npm ci/);
  assert.doesNotMatch(workflow,/run: npm install\s*$/m);
});

test("Windows installer is gated by full exact-commit verification",()=>{
  const verify=workflow.indexOf("run: npm run verify:full");
  const build=workflow.indexOf("run: npx tauri build --bundles nsis");
  assert.ok(verify>=0);
  assert.ok(build>verify);
  assert.match(workflow,/name: full-test-attestation/);
  assert.match(workflow,/path: \.shuvi-attest\/full-\*\.json/);
  assert.match(workflow,/if-no-files-found: error/);
});
