import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const fixture=readFileSync(new URL("./shuvi39-local-uia-fixture.ps1",import.meta.url),"utf8");
const ci=readFileSync(new URL("./shuvi39-synthetic-windows-uia-smoke.ps1",import.meta.url),"utf8");
test("disposable fixture must be explicitly opted in before creating a window",()=>{
 const gate=fixture.indexOf("if (-not $IApproveDisposableFixture)");
 const form=fixture.indexOf("$form=[System.Windows.Forms.Form]::new()");
 assert.ok(gate>0&&form>gate);
 assert.match(fixture,/param\(\[switch\]\$IApproveDisposableFixture\)/);
 assert.match(fixture,/No window launched/);
});
test("disposable fixture exposes real UIA test controls and readback",()=>{
 for(const marker of ["Shuvi39 Safe UIA Fixture","Shuvi39TestInput",
 "Shuvi39ApplyButton","Shuvi39TestToggle","Shuvi39 Readback Status",
 "Add_Click","Add_CheckedChanged","ShowDialog","premiere_or_blender_verified=$false"])
  assert.ok(fixture.includes(marker),marker);
 for(const forbidden of [/SetForegroundWindow\(/,/Start-Process\b/,
 /Invoke-WebRequest\b/,/CopyFromScreen\(/,/Remove-Item\b/,/Stop-Process\b/])
  assert.doesNotMatch(fixture,forbidden);
});
test("CI syntax parses but cannot launch the opt-in UI fixture",()=>{
 assert.match(ci,/Parser\]::ParseFile\(\$fixturePath,\[ref\]\$fixtureTokens,\[ref\]\$fixtureErrors\)/);
 assert.match(ci,/shuvi39-local-uia-fixture\.ps1/);
 assert.doesNotMatch(ci,/&\s+\$fixturePath/);
 assert.doesNotMatch(ci,/\.\s+\$fixturePath/);
});
