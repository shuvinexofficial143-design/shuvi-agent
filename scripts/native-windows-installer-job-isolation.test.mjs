import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const ci=readFileSync(new URL("../.github/workflows/ci.yml",import.meta.url),"utf8").replaceAll("\r\n","\n");
const rust=ci.slice(ci.indexOf("\n  rust:\n"),ci.indexOf("\n  windows-installer-acceptance:\n"));
const nsis=ci.slice(ci.indexOf("\n  windows-installer-acceptance:\n"));
test("M65 core Rust CI remains independent of heavy NSIS and always uploads original test attestation",()=>{
 assert.match(rust,/Rust verification with attestation/);
 assert.match(rust,/Build exact read-only SHA sidecar binary/);
 assert.match(rust,/Execute real Windows SHA worker and tamper-rejection fixtures/);
 assert.match(rust,/M59 real Windows installed-layout SHA worker fixture/);
 assert.match(rust,/Upload Rust attestation/);
 assert.doesNotMatch(rust,/npm run build:windows-installer|windows-m62-real-nsis-install-acceptance/);
});
test("M65 separately bounded Windows NSIS job executes the real exact package and installs without production release",()=>{
 assert.match(nsis,/runs-on: windows-latest/);
 assert.match(nsis,/timeout-minutes: 100/);
 assert.match(nsis,/actions\/setup-node@v4/);
 assert.match(nsis,/dtolnay\/rust-toolchain@stable/);
 assert.match(nsis,/run: npm ci/);
 assert.match(nsis,/run: npm run build:windows-installer/);
 assert.match(nsis,/run: node scripts\/windows-m62-real-nsis-install-acceptance\.mjs/);
 assert.match(nsis,/SHUVI_M62_EPHEMERAL_CI: "1"/);
 assert.match(nsis,/pinned-nsis-unsigned-acceptance-witnesses/);
 assert.match(nsis,/path: \.shuvi-release\/\*\.json/);
 assert.match(nsis,/if-no-files-found: error/);
 assert.match(nsis,/include-hidden-files: true/);
 assert.doesNotMatch(nsis,/upload-release-asset|create-release|actions\/upload-release|path: .*bundle\/nsis.*\.exe/);
 assert.doesNotMatch(nsis,/production[_ -]ready:\s*true|signed[_ -]installer:\s*true/i);
});
test("M65 branch PR remains unmerged and packaging cannot bypass source tests",()=>{
 assert.match(ci,/pull_request:/);
 assert.match(ci,/cancel-in-progress: true/);
 assert.match(ci,/^  frontend:/m);
 assert.match(ci,/^  rust:/m);
 assert.match(ci,/^  windows-installer-acceptance:/m);
 assert.doesNotMatch(ci,/automatically[_-]merge|pull_request_target:|GH_TOKEN:|GITHUB_TOKEN:/);
});
