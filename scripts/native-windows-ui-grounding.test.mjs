import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const agent=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
const preview=readFileSync(new URL("../.github/workflows/desktop-dashboard-preview.yml",import.meta.url),"utf8");

test("dynamic window and UI control discovery are permission-gated native tools",()=>{
  assert.match(src,/"ui_windows"\s*\|\s*"ui_discover"/);
  assert.match(src,/ToolAction::UiWindows => \{/);
  assert.match(src,/ToolAction::UiDiscover \{ window \} => \{/);
  assert.match(src,/ProcessId = \$pidValue; ProcessName = \$processName/);
  assert.match(src,/AutomationId=\$id/);
});
test("window matching prefers exact then one unambiguous equivalent",()=>{
  const root=src.slice(src.indexOf("fn ui_root_script("),src.indexOf("fn run_hidden_powershell("));
  assert.match(root,/\.Title -ieq \$requestedWindow/);
  assert.match(root,/adobe\|pro\|20\\d\\d/);
  assert.match(root,/\.Process/);
  assert.match(root,/\$selected.Count -ne 1/);
  assert.match(root,/Ambiguous window identity/);
  assert.doesNotMatch(root,/\$root = \$windows.Item\(0\)/);
});
test("UI mutations cannot blindly use loose synonyms or multiple matches",()=>{
  const matching=src.slice(src.indexOf("const UI_ELEMENT_RESOLVE_SCRIPT:"),src.indexOf("fn ui_root_script("));
  assert.match(matching,/\$wanted.Length -lt 3/);
  assert.match(matching,/\$distinct.Count -ne 1/);
  assert.match(matching,/\$uiRequestedAutomationId/);
  assert.match(matching,/\(& \$normalize \$label\) -eq \$wanted/);
  assert.equal((src.match(/\$matches = Resolve-ShuviUiMatches -root \$root -condition \$condition/g)||[]).length,8);
});
test("Master discovers observed UI and does not silently switch providers",()=>{
  assert.match(agent,/use ui_windows and ui_discover to ground current button labels/);
  assert.match(agent,/xKiro model capability is checked against its public catalog/);
  assert.match(agent,/No silent model switches or automatic paid retries/);
});
test("Windows preview installer is manual-only until repairs are accepted",()=>{
  assert.match(preview,/workflow_dispatch:/);
  assert.doesNotMatch(preview,/^\s*push:\s*$/m);
});

test("unsupported xKiro vision fails before any paid screenshot request",()=>{
  const stage=src.slice(src.indexOf('"inspect_screen" => {'),src.indexOf('"list_processes" => ('));
  assert.match(stage,/"gemini" \\| "anthropic" \\| "openai" \\| "openrouter"/);
  assert.match(src,/xKiro model.*is not marked vision-capable/);
  assert.match(src,/let catalog = list_xkiro_models\(\).await\?/);
  assert.match(src,/selected.vision != Some\(true\)/);
  assert.match(src,/"xkiro" => "https:\/\/api.xkiro.com\/v1\/chat\/completions"/);
});

test("xKiro capability comes from the public catalogue and prevents image-stripping surprises",()=>{
  assert.match(src,/vision: Option<bool>/);
  assert.ok(src.includes('v.get("vision")'));
  assert.match(src,/No screenshot or paid vision request was sent/);
});

test("Settings displays xKiro Vision capability before a screenshot task",()=>{
  const settings=readFileSync(new URL("../web-dashboard/src/native-model-setup.ts",import.meta.url),"utf8");
  assert.match(settings,/vision\?:boolean/);
  assert.match(settings,/Vision ✓/);
  assert.match(settings,/assign a Vision-enabled model to the Master role/);
});

test("ui_find absence is a real failure, so audit-gated recovery runs instead of false verified success",()=>{
 const arm=src.slice(src.indexOf("ToolAction::UiFind { name, automation_id, window } => {"),
  src.indexOf("ToolAction::UiClick { name, automation_id, window } => {"));
 assert.match(arm,/if \(\$items.Count -eq 0\) \{\{ throw 'No matching UI element found/);
 assert.match(arm,/UI lookup failed:/);
 assert.doesNotMatch(arm,/No matching controls\. Use ui_discover/);
 const ui=readFileSync(new URL("../web-dashboard/src/native-agent.ts",import.meta.url),"utf8");
 assert.match(ui,/receipt\.event==="failed"/);
 assert.match(ui,/receipt\.success===false/);
 assert.match(ui,/tool:"ui_windows",arguments:\{\}/);
});

test("universal UI discovery scans past early text-only nodes and prioritizes actionable roles",()=>{
  const discovery=src.slice(src.indexOf("ToolAction::UiDiscover { window } => {"),
    src.indexOf("ToolAction::UiFind { name, automation_id, window } => {"));
  assert.match(discovery,/Math\]::Min\(\$all\.Count, 1200\)/);
  assert.match(discovery,/Button\|MenuItem\|TabItem\|Hyperlink\|Edit\|ComboBox/);
  assert.match(discovery,/\$interactive\.Add\(\$item\)/);
  assert.match(discovery,/Select-Object -First 110/);
  assert.doesNotMatch(discovery,/if \(\$items.Count -ge 120\)/);
  assert.match(src,/NativeWindowHandle = \[int\]\$e.Current.NativeWindowHandle/);
});
