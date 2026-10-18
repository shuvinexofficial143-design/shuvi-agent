import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const ps=read("scripts/manual-owner-signed-windows-window-smoke.ps1");
const signature=read("scripts/check-shuvi-release-signatures.ps1");
const ci=read(".github/workflows/ci.yml");
test("M64 must never launch real main Shuvi app from CI or without exact owner consent",()=>{
  assert.match(ps,/\$env:CI -eq 'true' -or \$env:GITHUB_ACTIONS -eq 'true'/);
  assert.match(ps,/\$OwnerConsent -cne 'I APPROVE SHUVI WINDOW SMOKE'/);
  assert.match(ps,/\$ExpectedSignerThumbprint -cnotmatch '\^\[0-9A-Fa-f\]\{40\}\$'/);
  assert.doesNotMatch(ci,/run: .*manual-owner-signed-windows-window-smoke/);
  assert.match(ps,/Start-Process -FilePath \$exe -WorkingDirectory \$path -PassThru/);
  assert.match(ps,/\$exe=Join-Path \$path 'Shuvi\.exe'/);
  assert.match(ps,/\$deadline\.Elapsed\.TotalSeconds -lt 60/);
});
test("M64 publisher signature AND compressed NSIS main EXE evidence must be valid BEFORE approved startup",()=>{
  assert.match(ps,/\$witness\.packedMainExeSha256/);
  assert.match(ps,/Get-FileHash -LiteralPath \$exe -Algorithm SHA256/);
  assert.match(ps,/\$manifest\.installerSha256 -cne \$witness\.installerSha256/);
  assert.match(ps,/check-shuvi-release-signatures\.ps1/);
  assert.match(ps,/ownerWindowsVerified -ne \$false/);
  assert.match(ps,/\$gate\.mainAuthenticodeVerified -ne \$true/);
  assert.match(ps,/\$gate\.workerAuthenticodeVerified -ne \$true/);
  assert.match(ps,/\$gate\.installerAuthenticodeVerified -ne \$true/);
  assert.match(ps,/\$gate\.signerMatchesOwnerPinnedThumbprint -ne \$true/);
  assert.match(signature,/Get-AuthenticodeSignature -LiteralPath \$file/);
  assert.ok(ps.indexOf("check-shuvi-release-signatures.ps1")<ps.indexOf("Start-Process -FilePath $exe"));
});
test("M64 exact owner-launched main window only, cooperative shutdown and no false Adobe/background results",()=>{
  assert.match(ps,/\$process\.MainWindowHandle -ne \[IntPtr\]::Zero/);
  assert.match(ps,/\$process\.MainWindowTitle -match 'Shuvi'/);
  assert.match(ps,/\$process\.CloseMainWindow\(\)/);
  assert.match(ps,/\$process\.WaitForExit\(15000\)/);
  const nonComment=ps.split("\n").filter(x=>!x.trimStart().startsWith("#")).join("\n");
  assert.doesNotMatch(nonComment,/Stop-Process|TerminateProcess|taskkill|Invoke-WebRequest|Invoke-Expression|Start-Job/);
  for(const name of ["shaSidecarProtocolVerified","independentOwnerTaskApprovalVerified",
    "actualBackgroundParallelSchedulerVerified","blenderOrAdobeTaskVerified",
    "applicationJobOutcomeVerified","automaticRetryAuthorized"]){
    assert.match(ps,new RegExp(name+"=\\$false"));
  }
  assert.match(ps,/scope='manual-signed-owner-windows-window-only'/);
});
