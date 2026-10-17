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
 "readonly_control_reattestation_script","target_window_capture.rs",
 "native_target_window_capture_syntax_only",
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

test("capture PowerShell has two live Win32 surface checks bracketing CopyFromScreen",()=>{
 const rust=readFileSync(new URL("../src-tauri/src/target_window_capture.rs",import.meta.url),"utf8");
 const begin=rust.indexOf("function Assert-ShuviCaptureSurface");
 const before=rust.indexOf("Assert-ShuviCaptureSurface",begin+40);
 const copy=rust.indexOf("$graphics.CopyFromScreen(",before);
 const after=rust.indexOf("Assert-ShuviCaptureSurface",copy);
 const save=rust.indexOf("$bitmap.Save(",after);
 assert.ok(begin>0&&before>begin&&copy>before&&after>copy&&save>after);
 assert.match(rust.slice(begin,copy),/WindowFromPoint/);
 assert.match(rust.slice(begin,copy),/GetWindowThreadProcessId/);
});

test("native screenshot rejects same-process foreign top-level modal and popup overlays",()=>{
 const rust=readFileSync(new URL("../src-tauri/src/target_window_capture.rs",import.meta.url),"utf8");
 const source=rust.slice(rust.indexOf("function Assert-ShuviCaptureSurface"),
  rust.indexOf("# Sample visible target ownership both before",rust.indexOf("function Assert-ShuviCaptureSurface")));
 assert.match(rust,/GetAncestor\(IntPtr hWnd, uint flags\)/);
 const pid=source.indexOf("if ($hitPid -ne $nativePid)");
 const root=source.indexOf("GetAncestor($hit, [uint32]2)",pid);
 const refuse=source.indexOf("$hitRoot -ne $target",root);
 assert.ok(pid>=0&&root>pid&&refuse>root);
 assert.match(source,/Another top-level window covers the approved screenshot target/);
 assert.doesNotMatch(source,/GetAncestor\(\$hit, \[uint32\]3\)/);
 const copy=rust.indexOf("$graphics.CopyFromScreen(");
 const before=rust.indexOf("    Assert-ShuviCaptureSurface\n",rust.indexOf("function Assert-ShuviCaptureSurface"));
 const after=rust.indexOf("    Assert-ShuviCaptureSurface\n",copy);
 const save=rust.indexOf("$bitmap.Save(",after);
 assert.ok(before>=0&&before<copy&&copy<after&&after<save);
});

test("native screenshot reattests HWND, PID, root, geometry, foreground and pixels AFTER Bitmap.Save",()=>{
 const rust=readFileSync(new URL("../src-tauri/src/target_window_capture.rs",import.meta.url),"utf8");
 const saved=rust.indexOf("$bitmap.Save(");
 const pid=rust.indexOf("$pidAfterSave = 0",saved);
 const identity=rust.indexOf("$root.Current.NativeWindowHandle",pid);
 const geo=rust.indexOf("$finalRect.Right -ne $rect.Right",identity);
 const birth=rust.indexOf("Assert-ShuviCaptureProcessGeneration",geo);
 const surface=rust.indexOf("Assert-ShuviCaptureSurface",birth);
 const receipt=rust.indexOf("Title = $title",surface);
 assert.ok(saved>0&&pid>saved&&identity>pid&&geo>identity&&birth>geo&&surface>birth&&receipt>surface);
 assert.match(rust.slice(pid,surface),/GetForegroundWindow\(\) -ne \$target/);
 assert.match(rust.slice(pid,surface),/Approved target changed after screenshot encoding/);
 const returnImage=rust.indexOf("result.map(|identity| (path, identity))",receipt);
 assert.ok(returnImage>receipt);
});

test("Windows CI compiles the real target-capture Win32 C# interop without executing screenshot",()=>{
 const ps=readFileSync(new URL("./shuvi39-synthetic-windows-uia-smoke.ps1",import.meta.url),"utf8");
 const extract=ps.indexOf("$csharpStartMarker");
 const compile=ps.indexOf("Add-Type -TypeDefinition $csharpSource",extract);
 const signature=ps.indexOf("[ShuviTargetCaptureWin32].GetMethod('GetAncestor')",compile);
 const checks=ps.indexOf("$ancestor.ReturnType -ne [IntPtr]",signature);
 assert.ok(extract>0&&compile>extract&&signature>compile&&checks>signature);
 assert.match(ps,/\$parameters\[0\]\.ParameterType -ne \[IntPtr\]/);
 assert.match(ps,/\$parameters\[1\]\.ParameterType -ne \[uint32\]/);
 // CI is still read-only and must not call GetAncestor or copy an app image.
 assert.doesNotMatch(ps,/\[ShuviTargetCaptureWin32\]::GetAncestor\(/);
 assert.doesNotMatch(ps,/\[ShuviTargetCaptureWin32\]::SetForegroundWindow\(/);
});
