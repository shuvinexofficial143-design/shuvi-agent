# Shuvi 39 — explicit-operator read-only UIA acceptance diagnostic.
# DO NOT call from the AI action router. Run manually only with owner consent.
# Examples (not executed automatically):
#   powershell -NoProfile -File .\scripts\shuvi39-windows-uia-readonly-diagnostics.ps1 -WindowName "Adobe Premiere Pro 2026"
#   ... -WindowName "Blender" -MaxControls 16
# Default output hashes potentially sensitive window/control labels. -IncludeNames
# exposes labels only in local stdout, for explicitly authorized troubleshooting.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [ValidateLength(1,180)]
  [string]$WindowName,
  [ValidateRange(1,32)]
  [int]$MaxControls = 16,
  [switch]$IncludeNames
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Shuvi39ReadOnlyWindowInfo {
  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")]
  public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")]
  public static extern uint GetDpiForWindow(IntPtr hwnd);
}
'@ -ErrorAction Stop

function Get-LabelFingerprint {
  param([AllowEmptyString()][string]$Label)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Label)
    $digest = $sha.ComputeHash($bytes)
    return [BitConverter]::ToString($digest).Replace('-', '').Substring(0, 16).ToLowerInvariant()
  } finally { $sha.Dispose() }
}
function Get-SafeLabel {
  param([AllowEmptyString()][string]$Label)
  if ($IncludeNames.IsPresent) {
    if ($Label.Length -gt 180) { return $Label.Substring(0,180) }
    return $Label
  }
  return Get-LabelFingerprint $Label
}

if ([string]::IsNullOrWhiteSpace($WindowName) -or $WindowName.Trim() -cne $WindowName -or
    $WindowName -match '[\x00-\x1f\x7f]') {
  throw 'Provide an exact, bounded, non-control-character application title.'
}
$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$windows = $desktop.FindAll(
  [System.Windows.Automation.TreeScope]::Children,
  [System.Windows.Automation.Condition]::TrueCondition
)
$matches = New-Object 'System.Collections.Generic.List[System.Windows.Automation.AutomationElement]'
for ($i=0; $i -lt [Math]::Min(256, $windows.Count); $i++) {
  try {
    $el = $windows.Item($i)
    if ([string]::Equals([string]$el.Current.Name,$WindowName,
      [System.StringComparison]::OrdinalIgnoreCase)) { $matches.Add($el) }
  } catch { }
}
if ($matches.Count -ne 1) {
  throw 'The selected application title must resolve to exactly one top-level window. No diagnostic target selected.'
}
$root = $matches[0]
$hwnd = [IntPtr]([int64]$root.Current.NativeWindowHandle)
$pid = [uint32]$root.Current.ProcessId
if ($hwnd -eq [IntPtr]::Zero -or $pid -eq 0 -or
    -not [Shuvi39ReadOnlyWindowInfo]::IsWindow($hwnd) -or
    -not [Shuvi39ReadOnlyWindowInfo]::IsWindowVisible($hwnd) -or
    [Shuvi39ReadOnlyWindowInfo]::IsIconic($hwnd)) {
  throw 'Selected window is not visible and addressable; no diagnostic result.'
}
[uint32]$nativePid = 0
[void][Shuvi39ReadOnlyWindowInfo]::GetWindowThreadProcessId($hwnd,[ref]$nativePid)
if ($nativePid -ne $pid) { throw 'UIA and Win32 PID disagree; no diagnostic result.' }
$monitor = [Shuvi39ReadOnlyWindowInfo]::MonitorFromWindow($hwnd,[uint32]2)
$dpi = $null
try { $dpi = [int][Shuvi39ReadOnlyWindowInfo]::GetDpiForWindow($hwnd) } catch { }
$modal = $null
try {
  $pattern = $null
  if ($root.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern,[ref]$pattern)) {
    $modal = [bool]([System.Windows.Automation.WindowPattern]$pattern).Current.IsModal
  }
} catch { }

$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$queue = New-Object System.Collections.Queue
$queue.Enqueue([PSCustomObject]@{Element=$root; Depth=0})
$visited = 0
$maxVisited = 256
$rows = New-Object 'System.Collections.Generic.List[object]'
while ($queue.Count -gt 0 -and $visited -lt $maxVisited -and $rows.Count -lt $MaxControls) {
  $entry = $queue.Dequeue()
  $visited++
  $el = $entry.Element
  if ($entry.Depth -gt 0) {
    try {
      $info=$el.Current
      $name=[string]$info.Name
      $automationId=[string]$info.AutomationId
      $role=[string]$info.ControlType.ProgrammaticName
      [int[]]$runtime=$el.GetRuntimeId()
      if ($null -ne $runtime -and $runtime.Count -gt 0 -and $runtime.Count -le 64) {
        $rows.Add([PSCustomObject]@{
          name = Get-SafeLabel $name
          automation_id = Get-SafeLabel $automationId
          role = $role
          pid = [int]$info.ProcessId
          enabled = [bool]$info.IsEnabled
          offscreen = [bool]$info.IsOffscreen
          keyboard_focusable = [bool]$info.IsKeyboardFocusable
          runtime_id_length = $runtime.Count
          depth = $entry.Depth
        })
      }
    } catch { }
  }
  if ($entry.Depth -ge 8) { continue }
  # Strictly bounded traversal: a malicious UIA provider cannot cause
  # unlimited child/sibling visits or an unbounded serialized inventory.
  try {
    $child=$walker.GetFirstChild($el)
    $siblings=0
    while ($null -ne $child -and $siblings -lt 16 -and
           ($queue.Count + $visited) -lt $maxVisited) {
      $queue.Enqueue([PSCustomObject]@{Element=$child;Depth=$entry.Depth+1})
      $siblings++
      $child=$walker.GetNextSibling($child)
    }
  } catch { }
}
[PSCustomObject]@{
  schema = 'shuvi39.uia.readonly.v1'
  target_title = (Get-SafeLabel $WindowName)
  labels_revealed = [bool]$IncludeNames.IsPresent
  hwnd = [int64]$hwnd
  pid = [int]$pid
  monitor_handle = [int64]$monitor
  dpi = $dpi
  app_enabled = [bool]$root.Current.IsEnabled
  app_offscreen = [bool]$root.Current.IsOffscreen
  app_modal = $modal
  scanned_nodes = $visited
  returned_controls = $rows.Count
  controls = @($rows.ToArray())
} | ConvertTo-Json -Compress -Depth 6
