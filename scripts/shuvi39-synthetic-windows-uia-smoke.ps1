# Windows-only SYNTHETIC test. Do NOT run against owner applications.
# Parses native PowerShell generated-script fragments, then executes only a
# small synthetic in-memory AutomationElement-like identity object. Never
# sends keyboard/mouse/focus or interacts with the real desktop.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$guardPath = Join-Path $root 'src-tauri\src\native_uia_window_guard.rs'
if (-not [IO.File]::Exists($guardPath)) { throw 'Native UIA guard source unavailable.' }
$rust = [IO.File]::ReadAllText($guardPath)
function Get-RawNativeConstant {
 param([string]$Marker)
 $pattern = [regex]::Escape($Marker) + '(?<script>.*?)"#;'
 $found = [regex]::Match($rust,$pattern,[Text.RegularExpressions.RegexOptions]::Singleline)
 if (-not $found.Success) { throw ('Rust UIA script marker missing: ' + $Marker) }
 return $found.Groups['script'].Value
}
$win32 = Get-RawNativeConstant 'const WIN32_MUTATION_GUARD: &str = r#"'
$prepared = Get-RawNativeConstant 'const PREPARED_CONTROL_PROBE: &str = r#"'
$executor = Get-RawNativeConstant 'const NATIVE_CONTROL_EXECUTION_GUARD: &str = r#"'
$helperMarker = 'pub(super) fn readonly_control_reattestation_script()'
$helperAt = $rust.IndexOf($helperMarker,[StringComparison]::Ordinal)
if ($helperAt -lt 0) { throw 'Read-only control reattestation function missing.' }
$helperMatch=[regex]::Match($rust.Substring($helperAt),'r#"\s*(?<script>.*?)"#',
 [Text.RegularExpressions.RegexOptions]::Singleline)
if (-not $helperMatch.Success) { throw 'Native helper PowerShell block unavailable.' }
$helper=$helperMatch.Groups['script'].Value
# Syntax-parse the REAL capture PowerShell, which must not be executed
# on CI because it may change foreground focus and capture owner pixels.
$capturePath = Join-Path $root 'src-tauri\src\target_window_capture.rs'
if (-not [IO.File]::Exists($capturePath)) { throw 'Target capture source unavailable.' }
$captureRust = [IO.File]::ReadAllText($capturePath)
$captureMarker='let script = r#"'
$captureAt = $captureRust.IndexOf($captureMarker,[StringComparison]::Ordinal)
if ($captureAt -lt 0) { throw 'Native target capture script not found.' }
$captureMatch = [regex]::Match($captureRust.Substring($captureAt),
 'let script = r#"(?<script>.*?)"#',
 [Text.RegularExpressions.RegexOptions]::Singleline)
if (-not $captureMatch.Success) { throw 'Target capture PowerShell raw string unavailable.' }
$captureScript=$captureMatch.Groups['script'].Value
$sourcePieces = @(
 @{name='win32_attestation';source=$win32},
 @{name='native_prepare';source=$prepared},
 @{name='native_execution_guard';source=$executor},
 @{name='native_readonly_control_reattestation';source=$helper},
 @{name='native_target_window_capture_syntax_only';source=$captureScript}
)
foreach ($item in $sourcePieces){
 $tokens=$null; $parseErrors=$null
 [void][Management.Automation.Language.Parser]::ParseInput($item.source,[ref]$tokens,[ref]$parseErrors)
 if ($null -ne $parseErrors -and $parseErrors.Count -gt 0){
  $positions = @($parseErrors | Select-Object -First 3 | ForEach-Object { '{0}:{1}' -f $_.Extent.StartLineNumber,$_.Extent.StartColumnNumber })
  throw ('Native PowerShell syntax invalid in ' + $item.name + ' at ' + ($positions -join ', '))
 }
}
# Load the same actual Windows UIAutomationClient assembly as the native
# action. This verifies the expected .NET API types are present on Windows.
Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
# [Type]::GetType(type + ', UIAutomationClient') is sensitive to .NET
# assembly-load context on GitHub's Windows PowerShell runner. Resolve
# each real loaded API type via the assembly that PowerShell actually loaded.
$loadedAssemblies = [AppDomain]::CurrentDomain.GetAssemblies()
foreach ($typeName in @(
 'System.Windows.Automation.AutomationElement',
 'System.Windows.Automation.TogglePattern',
 'System.Windows.Automation.ExpandCollapsePattern',
 'System.Windows.Automation.ScrollPattern',
 'System.Windows.Automation.SelectionItemPattern'
)) {
 $found=$null
 foreach ($assembly in $loadedAssemblies) {
  $found=$assembly.GetType($typeName,$false,$false)
  if ($null -ne $found) {break}
 }
 if ($null -eq $found) {
   throw ('Required Windows UIA type not loaded: ' + $typeName)
 }
}
# Synthetic provider: no Form, real window, screen, application or UI action.
Add-Type -TypeDefinition @'
public sealed class Shuvi39SmokeType {
 public string ProgrammaticName {get;set;}
}
public sealed class Shuvi39SmokeCurrent {
 public int ProcessId {get;set;}
 public string Name {get;set;}
 public string AutomationId {get;set;}
 public Shuvi39SmokeType ControlType {get;set;}
 public bool IsEnabled {get;set;}
 public bool IsOffscreen {get;set;}
 public bool HasKeyboardFocus {get;set;}
}
public sealed class Shuvi39SmokeElement {
 public Shuvi39SmokeCurrent Current {get;set;}
 public int[] RuntimeId {get;set;}
 public int[] GetRuntimeId() {return RuntimeId;}
 public bool TryGetCurrentPattern(object pattern, ref object result) {
  result=null;
  return false;
 }
}
'@ -ErrorAction Stop
# Evaluate the production PowerShell reattestation function unmodified.
. ([scriptblock]::Create($helper))
$role=[Shuvi39SmokeType]::new()
$role.ProgrammaticName='ControlType.Button'
$info=[Shuvi39SmokeCurrent]::new()
$info.ProcessId=77
$info.Name='Save'
$info.AutomationId='save'
$info.ControlType=$role
$info.IsEnabled=$true
$info.IsOffscreen=$false
$info.HasKeyboardFocus=$false
$el=[Shuvi39SmokeElement]::new()
$el.Current=$info
$el.RuntimeId=[int[]]@(10,-3,99)
$observed=[PSCustomObject]@{
 Name='Save';AutomationId='save';ControlType='ControlType.Button';
 IsEnabled=$true;IsOffscreen=$false;ControlRuntimeId=[int[]]@(10,-3,99);
 HasKeyboardFocus=$false;ToggleState=$null;ExpandCollapseState=$null;
 IsSelected=$null;VerticalScrollPercent=$null
}
function Assert-MustReject {
 param([scriptblock]$Action,[string]$Case)
 $rejected=$false
 try { & $Action } catch {
  if ($_.Exception.Message -notlike '*Discard readback*'){
   throw ('Unexpected synthetic UIA error in '+$Case+': '+$_.Exception.Message)
  }
  $rejected=$true
 }
 if (-not $rejected) { throw ('Native UIA guard accepted changed '+$Case) }
}
# Positive reference, followed by adversarial changes to the original
# reference, not a newly resolved equal-label copy.
Assert-ShuviObservedControl -element $el -observed $observed -rootPid 77
$el.RuntimeId=[int[]]@(10,-3,98)
Assert-MustReject {Assert-ShuviObservedControl -element $el -observed $observed -rootPid 77} 'RuntimeId'
$el.RuntimeId=[int[]]@(10,-3,99)
$info.AutomationId='other'
Assert-MustReject {Assert-ShuviObservedControl -element $el -observed $observed -rootPid 77} 'AutomationId'
$info.AutomationId='save'
$info.ControlType.ProgrammaticName='ControlType.Edit'
Assert-MustReject {Assert-ShuviObservedControl -element $el -observed $observed -rootPid 77} 'ControlType'
$info.ControlType.ProgrammaticName='ControlType.Button'
$info.IsEnabled=$false
Assert-MustReject {Assert-ShuviObservedControl -element $el -observed $observed -rootPid 77} 'disabled'
$info.IsEnabled=$true
$info.IsOffscreen=$true
Assert-MustReject {Assert-ShuviObservedControl -element $el -observed $observed -rootPid 77} 'offscreen'
$info.IsOffscreen=$false
$info.HasKeyboardFocus=$true
Assert-MustReject {Assert-ShuviObservedControl -element $el -observed $observed -rootPid 77} 'focus'
$info.HasKeyboardFocus=$false
$info.ProcessId=88
Assert-MustReject {Assert-ShuviObservedControl -element $el -observed $observed -rootPid 77} 'owner PID'
$info.ProcessId=77
$observed.ToggleState='On'
Assert-MustReject {Assert-ShuviObservedControl -element $el -observed $observed -rootPid 77} 'unavailable toggle provider'
$observed.ToggleState=$null
Assert-ShuviObservedControl -element $el -observed $observed -rootPid 77
# Deliberately no live application/UIA provider was inspected or changed.
[PSCustomObject]@{
 schema='shuvi39.synthetic_windows_uia.v1'
 mode='windows_powershell_parser_and_synthetic_identity'
 production_desktop_tested=$false
 adobe_app_tested=$false
 provider_ui_automation_tested=$false
 mutations_sent=0
 scripted_fragments_parsed=$sourcePieces.Count
 synthetic_cases=8
 passed=$true
} | ConvertTo-Json -Compress
