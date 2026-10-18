import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const payload=read("scripts/check-real-nsis-payload.ps1");
const builder=read("scripts/build-pinned-sha-installer.mjs");
const ci=read(".github/workflows/ci.yml");
const manifest=read("scripts/native-pinned-release-manifest.mjs");
const pkg=JSON.parse(read("package.json"));

test("M60 only a real extracted NSIS payload with exact worker SHA satisfies package acceptance",()=>{
 assert.match(payload,/Get-FileHash -LiteralPath \$workers\[0\]\.FullName -Algorithm SHA256/);
 assert.match(payload,/Get-FileHash -LiteralPath \$installer -Algorithm SHA256/);
 assert.match(payload,/\$workers\.Count -ne 1 -or \$main\.Count -ne 1/);
 assert.match(payload,/Get-ChildItem -LiteralPath \$extract -File -Recurse -Force/);
 assert.match(payload,/\$LASTEXITCODE -ne 0/);
 assert.match(payload,/\$worker\.Name -cne \$manifest\.workerFilename/);
 assert.match(payload,/exactPackedWorkerSha256Matched=\$true/);
 assert.match(payload,/actualNsisPayloadExtracted=\$true/);
 assert.match(payload,/installedWindowsVerified=\$false/);
 assert.match(payload,/signingVerified=\$false/);
 assert.match(payload,/ownerDesktopEndToEndVerified=\$false/);
 assert.match(payload,/Remove-Item -LiteralPath \$extract -Force -Recurse/);
 // NSIS package *extraction*, not silent installer execution.
 assert.doesNotMatch(payload,/Start-Process|msiexec|\/S\s+\/D=|Invoke-Expression|Invoke-WebRequest|curl\.exe/);
});

test("M60 pinned release builder gates success on independent compressed NSIS file extraction",()=>{
 assert.match(builder,/createUnsignedReleaseEvidence/);
 assert.match(builder,/verifyUnsignedReleaseEvidence/);
 assert.match(builder,/check-real-nsis-payload\.ps1/);
 assert.match(builder,/if\(payload\.error\|\|payload\.status!==0\)/);
 assert.match(builder,/Actual compressed NSIS worker payload mismatches pinned SHA/);
 assert.match(builder,/shell:false/);
 assert.match(builder,/SHUVI_REQUIRE_PINNED_SHA_SIDECAR:"1"/);
 assert.match(pkg.scripts["build:windows-installer"],/prepare:sha-sidecar.*build-pinned-sha-installer\.mjs/);
});

test("M60 Windows native CI builds actual NSIS and uploads ONLY witness, not executable",()=>{
 assert.match(ci,/M60 build real pinned Windows NSIS/);
 assert.match(ci,/npm run build:windows-installer/);
 assert.match(ci,/npm ci/);
 assert.match(ci,/pinned-nsis-unsigned-acceptance-witnesses/);
 assert.match(ci,/path: \.shuvi-release\/\*\.json/);
 assert.doesNotMatch(ci,/path: .*bundle\/nsis.*\.exe/);
 assert.match(manifest,/signingVerified:false,installedWindowsVerified:false,applicationVerified:false/);
 assert.match(manifest,/function digest\(path\)/);
});

test("M66 actual Tauri 2.11.5 CLI targets the same MSVC output as Cargo sidecar and NSIS witness",()=>{
 assert.match(builder,/const target=process\.env\.CARGO_BUILD_TARGET\|\|host/);
 assert.match(builder,/CARGO_BUILD_TARGET:target/);
 assert.match(builder,/spawnSync\(process\.execPath,\[tauriJs,"build","--target",target,"--config"/);
 assert.match(builder,/resolve\("src-tauri","target",target,"release","bundle","nsis"\)/);
 assert.doesNotMatch(builder,/--target","?undefined|--target",host/);
});
