import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("./shuvi39-synthetic-windows-uia-smoke.ps1",import.meta.url),"utf8");
const workflow=readFileSync(new URL("../.github/workflows/ci.yml",import.meta.url),"utf8");
test("GitHub Windows Rust workflow runs synthetic PowerShell before Rust verification",()=>{
 const readiness=workflow.indexOf("Windows read-only readiness script execution");
 const smoke=workflow.indexOf("Shuvi39 synthetic Windows PowerShell UIA smoke");
 const rust=workflow.indexOf("Rust verification with attestation");
 assert.ok(smoke>readiness&&rust>smoke);
 assert.match(workflow,/shell: powershell\s+run: \.\\scripts\\shuvi39-synthetic-windows-uia-smoke\.ps1/);
 assert.match(workflow,/runs-on: windows-latest/);
});
test("Windows runtime smoke extracts original production native script and parses it",()=>{
 for(const marker of ["native_uia_window_guard.rs","WIN32_MUTATION_GUARD",
 "PREPARED_CONTROL_PROBE","NATIVE_CONTROL_EXECUTION_GUARD",
 "readonly_control_reattestation_script",
 "Management.Automation.Language.Parser","ParseInput",
 "UIAutomationClient","AutomationElement","TogglePattern","ExpandCollapsePattern"])
  assert.ok(source.includes(marker),"missing "+marker);
});
test("smoke evaluates real native read-only PowerShell helper against synthetic changed controls",()=>{
 for(const marker of ["[scriptblock]::Create($helper)","Assert-ShuviObservedControl",
  "Assert-MustReject","RuntimeId","AutomationId","ControlType","disabled",
  "offscreen","focus","owner PID","unavailable toggle provider"])
  assert.ok(source.includes(marker),"missing "+marker);
});
test("smoke never manipulates an owner desktop or claims real application acceptance",()=>{
 for(const forbidden of [/\bSetForegroundWindow\s*\(/i,/\bSendWait\s*\(/i,
 /\.SetFocus\s*\(/i,/\.Invoke\s*\(/i,/\.Toggle\s*\(/i,/\.SetValue\s*\(/i,
 /Start-Process\b/i,/GetForegroundWindow\s*\(/i,/\.Click\s*\(/i])
  assert.doesNotMatch(source,forbidden);
 for(const marker of ["production_desktop_tested=$false","adobe_app_tested=$false",
  "provider_ui_automation_tested=$false","mutations_sent=0"])
  assert.ok(source.includes(marker),"honest report missing "+marker);
});
