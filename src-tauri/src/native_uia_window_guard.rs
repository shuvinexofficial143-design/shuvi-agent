// Shuvi 39 — Native UIA owner-reviewed target binding.
// The model supplies only an approved selector. The OS-derived HWND, PID,
// title, control RuntimeId and exact UIA metadata remain in Rust PendingAction.
// A different control with the same name may never inherit that approval.
use serde_json::Value;

// UIA RuntimeIds are short-lived identities, not a reusable permission.
// General native actions retain their original 10-minute TTL unchanged.
pub(super) const NATIVE_UIA_PREPARED_TTL_MS: u64 = 60_000;
pub(super) fn expired_native_uia_binding(
    prepared_at_ms: u64,
    now_ms: u64,
    target: Option<&NativeUiaTarget>,
) -> bool {
    target.is_some()
        && (now_ms < prepared_at_ms
            || now_ms.saturating_sub(prepared_at_ms) > NATIVE_UIA_PREPARED_TTL_MS)
}

#[derive(Debug, Clone)]
pub(super) struct NativeUiaTarget {
    pub(super) hwnd: i64,
    pub(super) pid: u32,
    // App-process generation prevents HWND/PID reuse after a restart.
    pub(super) process_start_ticks: i64,
    pub(super) title: String,
    pub(super) runtime_id: Vec<i32>,
    pub(super) control_name: String,
    pub(super) automation_id: String,
    pub(super) control_type: String,
}

const WIN32_MUTATION_GUARD: &str = r#"
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ShuviUiaNativeIdentity {
 [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
 public static extern bool IsWindow(IntPtr hwnd);
 [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
 public static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
 public static extern bool IsIconic(IntPtr hwnd);
 [DllImport("user32.dll")]
 public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
 [DllImport("user32.dll")]
 public static extern IntPtr GetForegroundWindow();
}
'@ -ErrorAction Stop
"#;

// Read the window and one exact selected control in ONE native prepare probe.
// Ambiguous/hidden/disabled controls never become a Rust approval capability.
// Window identity and RuntimeId are gathered together from one UIA snapshot.
const PREPARED_CONTROL_PROBE: &str = r#"$shuviBoundHwnd = [IntPtr]([int64]$root.Current.NativeWindowHandle)
$shuviBoundPid = [int]$root.Current.ProcessId
if ($shuviBoundHwnd -eq [IntPtr]::Zero -or $shuviBoundPid -le 0 -or
    -not [ShuviUiaNativeIdentity]::IsWindow($shuviBoundHwnd) -or
    -not [ShuviUiaNativeIdentity]::IsWindowVisible($shuviBoundHwnd) -or
    [ShuviUiaNativeIdentity]::IsIconic($shuviBoundHwnd)) {
 throw 'Cannot bind UI action: target HWND absent, hidden or minimized.'
}
# A blocked owner window behind a modal dialog is not an eligible target.
# UIA IsEnabled/IsOffscreen is read-only evidence; no focus/restore is attempted.
if (-not [bool]$root.Current.IsEnabled -or [bool]$root.Current.IsOffscreen) {
 throw 'Cannot bind disabled or offscreen native application root.'
}
[uint32]$shuviBoundNativePid = 0
[void][ShuviUiaNativeIdentity]::GetWindowThreadProcessId($shuviBoundHwnd,[ref]$shuviBoundNativePid)
if ($shuviBoundNativePid -eq 0 -or $shuviBoundNativePid -ne [uint32]$shuviBoundPid) {
 throw 'Cannot bind UI action: native and UIA window PID differ.'
}
# Read OS creation time from the actual process, not AI or cached title.
try {
 $shuviProcess = Get-Process -Id $shuviBoundPid -ErrorAction Stop
 [int64]$shuviBoundProcessStartTicks = $shuviProcess.StartTime.ToUniversalTime().Ticks
} catch {
 throw 'Cannot bind app process creation time; no action prepared.'
}
if ($shuviBoundProcessStartTicks -le 0) {
 throw 'Invalid app process start time; no action prepared.'
}
[uint32]$shuviBoundRecheckPid = 0
[void][ShuviUiaNativeIdentity]::GetWindowThreadProcessId($shuviBoundHwnd,[ref]$shuviBoundRecheckPid)
if ($shuviBoundRecheckPid -ne [uint32]$shuviBoundPid) {
 throw 'App process changed during preparation; no action prepared.'
}
$title = [string]$root.Current.Name
if ([string]::IsNullOrWhiteSpace($title)) { throw 'Cannot bind unnamed target window.' }
$matches = Resolve-ShuviUiMatches -root $root -condition $condition
if ($matches.Count -ne 1) { throw 'Cannot bind UI action: selector did not resolve exactly one control.' }
$control = $matches.Item(0)
if ([int]$control.Current.ProcessId -ne $shuviBoundPid -or
    -not [bool]$control.Current.IsEnabled -or
    [bool]$control.Current.IsOffscreen) {
 throw 'Cannot bind foreign, disabled or offscreen UIA control.'
}
[int[]]$runtimeId = $control.GetRuntimeId()
if ($null -eq $runtimeId -or $runtimeId.Count -lt 1 -or $runtimeId.Count -gt 64) {
 throw 'Cannot bind UIA control without a bounded native RuntimeId.'
}
# Pattern availability is inspected before the user is asked to approve.
# A pattern check is read-only, and a later native mutation independently
# checks pattern availability again after the exact RuntimeId check.
__CAPABILITY_PREFLIGHT__
[PSCustomObject]@{
 hwnd = [int64]$shuviBoundHwnd
 pid = $shuviBoundPid
 process_start_ticks = [int64]$shuviBoundProcessStartTicks
 title = $title
 runtime_id = [int[]]$runtimeId
 control_name = [string]$control.Current.Name
 automation_id = [string]$control.Current.AutomationId
 control_type = [string]$control.Current.ControlType.ProgrammaticName
} | ConvertTo-Json -Compress -Depth 4
"#;

// Pattern is *not* passed in from the AI or WebView. The Rust ToolAction
// discriminant chooses this allowlisted read-only test.
fn capability_preflight(tool: &str) -> Result<&'static str, String> {
    match tool {
        "ui_click" => Ok(r#"
$shuviInvoke=$null; $shuviSelection=$null
if (-not $control.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$shuviInvoke) -and
    -not $control.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$shuviSelection)) {
 throw 'Prepared target lacks InvokePattern and SelectionItemPattern.'
}
"#),
        "ui_set_value" => Ok(r#"
$shuviValue=$null
if (-not $control.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$shuviValue)) {
 throw 'Prepared target lacks ValuePattern.'
}
if (([System.Windows.Automation.ValuePattern]$shuviValue).Current.IsReadOnly) {
 throw 'Prepared ValuePattern is read-only.'
}
"#),
        "ui_focus" | "ui_send_keys" => Ok(r#"
if (-not [bool]$control.Current.IsKeyboardFocusable) {
 throw 'Prepared target cannot receive keyboard focus.'
}
"#),
        "ui_scroll" => Ok(r#"
$shuviScroll=$null
if (-not $control.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern,[ref]$shuviScroll)) {
 throw 'Prepared target lacks ScrollPattern.'
}
if (-not [bool](([System.Windows.Automation.ScrollPattern]$shuviScroll).Current.VerticallyScrollable)) {
 throw 'Prepared target has no vertical scroll capability.'
}
"#),
        "ui_toggle" => Ok(r#"
$shuviToggle=$null
if (-not $control.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$shuviToggle)) {
 throw 'Prepared target lacks TogglePattern.'
}
"#),
        "ui_expand_collapse" => Ok(r#"
$shuviExpand=$null
if (-not $control.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$shuviExpand)) {
 throw 'Prepared target lacks ExpandCollapsePattern.'
}
"#),
        _ => Err("Unrecognized UIA mutation capability; native preparation rejected.".into()),
    }
}

pub(super) fn prepared_control_probe(
    root_script: &str,
    selector_script: &str,
    tool: &str,
) -> Result<String, String> {
    // Capability snippets are Rust-only constants; a proposal never injects
    // an arbitrary PowerShell fragment into this permissioned native probe.
    let check = capability_preflight(tool)?;
    let native = PREPARED_CONTROL_PROBE.replace("__CAPABILITY_PREFLIGHT__", check);
    // The observed selector/window scripts are appended by one-pass
    // formatting and cannot recursively expand the replacement sentinel.
    Ok(format!("Add-Type -AssemblyName UIAutomationClient\n{selector_script}\n{root_script}\n{WIN32_MUTATION_GUARD}\n{native}"))
}

// A read-only UIA query is observation evidence, not merely a successful
// PowerShell process. Validate its selected top-level HWND/PID against Win32
// both before enumeration and after gathering results. No focus or restore.
pub(super) fn readonly_window_attestation_script() -> String {
    format!(r#"{WIN32_MUTATION_GUARD}
$shuviReadHwnd = [IntPtr]([int64]$root.Current.NativeWindowHandle)
$shuviReadPid = [int]$root.Current.ProcessId
$shuviReadTitle = [string]$root.Current.Name
# One process-generation snapshot is bound to BOTH the before and after
# read-only UIA enumeration checks. Failure to read it is not proof.
try {{
 $shuviReadProcess = Get-Process -Id $shuviReadPid -ErrorAction Stop
 [int64]$shuviReadStartTicks = $shuviReadProcess.StartTime.ToUniversalTime().Ticks
}} catch {{
 throw 'Observed UIA process creation time unavailable. Discard readback.'
}}
if ($shuviReadStartTicks -le 0) {{
 throw 'Observed UIA process birth time is invalid. Discard readback.'
}}
function Assert-ShuviObservedWindow {{
 if ($shuviReadHwnd -eq [IntPtr]::Zero -or $shuviReadPid -le 0 -or
     [string]::IsNullOrWhiteSpace($shuviReadTitle) -or
     -not [ShuviUiaNativeIdentity]::IsWindow($shuviReadHwnd) -or
     -not [ShuviUiaNativeIdentity]::IsWindowVisible($shuviReadHwnd) -or
     [ShuviUiaNativeIdentity]::IsIconic($shuviReadHwnd)) {{
  throw 'Observed UIA window missing, invisible or minimized. No trusted readback.'
 }}
 [uint32]$shuviNativeReadPid = 0
 [void][ShuviUiaNativeIdentity]::GetWindowThreadProcessId($shuviReadHwnd, [ref]$shuviNativeReadPid)
 try {{
  $shuviCurrentReadProcess = Get-Process -Id $shuviReadPid -ErrorAction Stop
  [int64]$shuviReadLiveTicks = $shuviCurrentReadProcess.StartTime.ToUniversalTime().Ticks
 }} catch {{
  throw 'Observed UIA process exited during readback. Discard readback.'
 }}
 if ($shuviReadLiveTicks -ne $shuviReadStartTicks) {{
  throw 'Observed UIA process restarted during readback. Discard readback.'
 }}
 if ($shuviNativeReadPid -ne [uint32]$shuviReadPid -or
     [int64]$root.Current.NativeWindowHandle -ne [int64]$shuviReadHwnd -or
     [int]$root.Current.ProcessId -ne $shuviReadPid -or
     [string]$root.Current.Name -cne $shuviReadTitle -or
     -not [bool]$root.Current.IsEnabled -or
     [bool]$root.Current.IsOffscreen) {{
  throw 'Observed UIA root HWND/PID/title changed or became inactive. Discard readback.'
 }}
}}
Assert-ShuviObservedWindow
"#)
}

fn valid_label(value: &str, max: usize, allow_empty: bool) -> bool {
    (allow_empty || !value.is_empty())
        && value.chars().count() <= max
        && !value.chars().any(char::is_control)
}
pub(super) fn parse_prepared_control(output: &str) -> Result<NativeUiaTarget, String> {
    if output.len() > 8192 {
        return Err("Prepared native control evidence exceeds safety size limit.".into());
    }
    let v: Value = serde_json::from_str(output.trim())
        .map_err(|_| "Prepared native UIA identity was not valid JSON.".to_string())?;
    let hwnd = v.get("hwnd").and_then(Value::as_i64).unwrap_or(0);
    let pid = v.get("pid").and_then(Value::as_u64).unwrap_or(0);
    let process_start_ticks = v.get("process_start_ticks").and_then(Value::as_i64).unwrap_or(0);
    let title = v.get("title").and_then(Value::as_str).unwrap_or("");
    let name = v.get("control_name").and_then(Value::as_str).unwrap_or("");
    let automation_id = v.get("automation_id").and_then(Value::as_str).unwrap_or("");
    let control_type = v.get("control_type").and_then(Value::as_str).unwrap_or("");
    let source = v.get("runtime_id").and_then(Value::as_array)
        .ok_or_else(|| "No native UIA control RuntimeId in prepared evidence.".to_string())?;
    if source.is_empty() || source.len() > 64 {
        return Err("Native UIA RuntimeId is empty or exceeds the safe limit.".into());
    }
    let runtime_id = source.iter()
        .map(|part| part.as_i64().and_then(|n| i32::try_from(n).ok()))
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| "UIA RuntimeId contains an invalid integer.".to_string())?;
    if hwnd <= 0 || pid == 0 || pid > u32::MAX as u64 || process_start_ticks <= 0 ||
        title.trim() != title || !valid_label(title, 180, false) ||
        !valid_label(name, 180, true) ||
        !valid_label(automation_id, 180, true) ||
        (name.is_empty() && automation_id.is_empty()) ||
        !valid_label(control_type, 100, false) {
        return Err("Prepared HWND/PID/control identity is missing or malformed.".into());
    }
    Ok(NativeUiaTarget {
        hwnd, pid: pid as u32, process_start_ticks, title: title.to_string(), runtime_id,
        control_name: name.to_string(),
        automation_id: automation_id.to_string(),
        control_type: control_type.to_string(),
    })
}

const NATIVE_CONTROL_EXECUTION_GUARD: &str = r#"
function Assert-ShuviNativeTarget {
 param($root, $element, [switch]$requireForeground)
 if ($shuviExpectedHwnd -eq [IntPtr]::Zero -or $shuviExpectedPid -eq 0 -or
     -not [ShuviUiaNativeIdentity]::IsWindow($shuviExpectedHwnd) -or
     -not [ShuviUiaNativeIdentity]::IsWindowVisible($shuviExpectedHwnd) -or
     [ShuviUiaNativeIdentity]::IsIconic($shuviExpectedHwnd)) {
  throw 'Prepared HWND is gone, hidden or minimized. No UI mutation sent.'
 }
 [uint32]$nativePid = 0
 [void][ShuviUiaNativeIdentity]::GetWindowThreadProcessId($shuviExpectedHwnd, [ref]$nativePid)
 # Even reused numeric HWND/PID cannot carry owner consent after restart.
 try {
  $shuviLiveProcess = Get-Process -Id ([int]$shuviExpectedPid) -ErrorAction Stop
  [int64]$shuviLiveStartTicks = $shuviLiveProcess.StartTime.ToUniversalTime().Ticks
 } catch {
  throw 'Approved application process exited or its birth time cannot be inspected. No mutation sent.'
 }
 if ($shuviLiveStartTicks -ne $shuviExpectedProcessStartTicks) {
  throw 'Application process restarted after approval. No UI mutation sent.'
 }
 if (-not [bool]$root.Current.IsEnabled -or [bool]$root.Current.IsOffscreen) {
  throw 'Prepared UIA owner window became disabled or offscreen. No mutation sent.'
 }
 if ($nativePid -ne $shuviExpectedPid -or
     [int64]$root.Current.NativeWindowHandle -ne [int64]$shuviExpectedHwnd -or
     [int]$root.Current.ProcessId -ne [int]$shuviExpectedPid -or
     [string]$root.Current.Name -cne $shuviExpectedTitle) {
  throw 'Prepared HWND/PID/title changed before execution. No UI mutation sent.'
 }
 if ($null -eq $element -or
     [int]$element.Current.ProcessId -ne [int]$shuviExpectedPid -or
     [bool]$element.Current.IsOffscreen -or
     -not [bool]$element.Current.IsEnabled) {
  throw 'Selected UIA control is foreign, disabled or offscreen. No UI mutation sent.'
 }
 # A recycled AutomationId or same-label control must never inherit another
 # approved action. GetRuntimeId is native UIA identity for this element.
 [int[]]$actualRuntimeId = $element.GetRuntimeId()
 if ($null -eq $actualRuntimeId -or
     $actualRuntimeId.Count -ne $shuviExpectedRuntimeCount -or
     ($actualRuntimeId -join ',') -cne $shuviExpectedRuntimeKey -or
     [string]$element.Current.Name -cne $shuviExpectedControlName -or
     [string]$element.Current.AutomationId -cne $shuviExpectedAutomationId -or
     [string]$element.Current.ControlType.ProgrammaticName -cne $shuviExpectedControlType) {
  throw 'UIA control identity changed after approval. No UI mutation sent.'
 }
 if ($requireForeground -and
     [ShuviUiaNativeIdentity]::GetForegroundWindow() -ne $shuviExpectedHwnd) {
  throw 'Keyboard target is not the foreground HWND. No keys sent.'
 }
}
"#;

// Before each native UIA mutation the chosen element must still be the exact
// OS-bound control observed during the Rust preparation/owner approval cycle.
pub(super) fn guarded_mutation_root(
    window: Option<&str>, root_script: String, target: Option<&NativeUiaTarget>
) -> Result<String, String> {
    let name = window.map(str::trim)
        .filter(|s| !s.is_empty() && s.chars().count() <= 180)
        .ok_or_else(|| "UI mutation requires an explicit observed application window; never use desktop root.".to_string())?;
    if name.eq_ignore_ascii_case("desktop") || name.chars().any(char::is_control) {
        return Err("UI mutation cannot target desktop or a control-formatted window.".into());
    }
    let t = target.ok_or_else(|| "UIA mutation has no Rust-prepared HWND/PID/control identity.".to_string())?;
    if t.hwnd <= 0 || t.pid == 0 || t.process_start_ticks <= 0 ||
        t.title.trim() != t.title || !valid_label(&t.title, 180, false) ||
        !valid_label(&t.control_name, 180, true) ||
        !valid_label(&t.automation_id, 180, true) ||
        (t.control_name.is_empty() && t.automation_id.is_empty()) ||
        !valid_label(&t.control_type, 100, false) ||
        t.runtime_id.is_empty() || t.runtime_id.len() > 64 {
        return Err("Rust-prepared UIA control identity is invalid.".into());
    }
    let title = t.title.replace('\'', "''");
    let control_name = t.control_name.replace('\'', "''");
    let control_id = t.automation_id.replace('\'', "''");
    let control_type = t.control_type.replace('\'', "''");
    let runtime_key = t.runtime_id.iter().map(i32::to_string).collect::<Vec<_>>().join(",");
    Ok(format!(
        "{root_script}\n{WIN32_MUTATION_GUARD}\n\
         $shuviExpectedHwnd = [IntPtr]([int64]{})\n\
         $shuviExpectedPid = [uint32]{}\n\
         $shuviExpectedProcessStartTicks = [int64]{}\n\
         $shuviExpectedTitle = '{}'\n\
         $shuviExpectedControlName = '{}'\n\
         $shuviExpectedAutomationId = '{}'\n\
         $shuviExpectedControlType = '{}'\n\
         $shuviExpectedRuntimeCount = {}\n\
         $shuviExpectedRuntimeKey = '{}'\n\
         {NATIVE_CONTROL_EXECUTION_GUARD}",
        t.hwnd, t.pid, t.process_start_ticks, title, control_name, control_id, control_type,
        t.runtime_id.len(), runtime_key
    ))
}

#[cfg(test)]
mod tests {
    use super::{NativeUiaTarget, guarded_mutation_root, parse_prepared_control, prepared_control_probe};
    fn target() -> NativeUiaTarget {
        NativeUiaTarget {
            hwnd: 901, pid: 123, process_start_ticks: 638962980000000000, title: "Adobe Premiere Pro 2026".into(),
            runtime_id: vec![42, -3, 91], control_name: "New Project".into(),
            automation_id: "new_project".into(), control_type: "ControlType.Button".into(),
        }
    }
    fn observed() -> &'static str {
        r#"{"hwnd":901,"pid":123,"process_start_ticks":638962980000000000,"title":"Adobe Premiere Pro 2026","runtime_id":[42,-3,91],"control_name":"New Project","automation_id":"new_project","control_type":"ControlType.Button"}"#
    }
    #[test]
    fn readonly_window_attestation_is_repeatable_win32_verified_and_nonmutating() {
        let script=super::readonly_window_attestation_script();
        for check in ["GetWindowThreadProcessId", "IsWindowVisible", "IsIconic",
            "Get-Process -Id $shuviReadPid", "StartTime.ToUniversalTime().Ticks",
            "Observed UIA process restarted during readback",
            "Assert-ShuviObservedWindow", "$shuviReadHwnd", "$shuviReadPid",
            "IsOffscreen", "Discard readback"] {
            assert!(script.contains(check), "Missing {check}");
        }
        assert!(!script.contains("SetForegroundWindow"));
        assert!(!script.contains("SendWait("));
    }
    #[test]
    fn parses_exact_os_runtime_and_control_identity() {
        let result = parse_prepared_control(observed()).unwrap();
        assert_eq!(result.hwnd, 901);
        assert_eq!(result.pid, 123);
        assert_eq!(result.process_start_ticks, 638962980000000000);
        assert_eq!(result.runtime_id, vec![42, -3, 91]);
        assert_eq!(result.automation_id, "new_project");
    }
    #[test]
    fn rejects_missing_overlarge_ambiguous_or_invalid_control_identity() {
        for output in ["{}", "[]", "not json",
            r#"{"hwnd":901,"pid":123,"title":"Premiere","runtime_id":[],"control_name":"Save","control_type":"Button"}"#,
            r#"{"hwnd":901,"pid":123,"title":"Premiere","runtime_id":["wrong"],"control_name":"Save","control_type":"Button"}"#,
            r#"{"hwnd":901,"pid":123,"title":"Premiere","runtime_id":[1],"control_name":"","automation_id":"","control_type":"Button"}"#,
            r#"{"hwnd":901,"pid":123,"title":"Premiere","runtime_id":[1],"control_name":"Save","control_type":""}"#] {
            assert!(parse_prepared_control(output).is_err(), "accepted invalid control evidence: {output}");
        }
        assert!(parse_prepared_control(&" ".repeat(8193)).is_err());
    }
    #[test]
    fn prepare_script_observes_win32_and_one_actual_control_in_one_process() {
        let script = prepared_control_probe("$root=$nativeWindow", "$condition=$selector", "ui_click").unwrap();
        for token in ["$nativeWindow","$selector", "GetWindowThreadProcessId",
            "Get-Process -Id", "StartTime.ToUniversalTime().Ticks",
            "IsWindowVisible", "Resolve-ShuviUiMatches", "$matches.Count -ne 1",
            "GetRuntimeId()", "ConvertTo-Json"] {
            assert!(script.contains(token), "missing {token}");
        }
    }
    #[test]
    fn execution_checks_prepared_window_and_exact_runtime_control() {
        let script = guarded_mutation_root(Some("Premiere"), "$root=42".into(), Some(&target())).unwrap();
        assert!(script.starts_with("$root=42\n"));
        for token in ["[int64]901", "[uint32]123", "[int64]638962980000000000",
            "$shuviExpectedProcessStartTicks", "Application process restarted after approval",
            "$shuviExpectedRuntimeKey",
            "$actualRuntimeId -join ','", "$shuviExpectedControlName",
            "$shuviExpectedAutomationId", "$shuviExpectedControlType",
            "GetForegroundWindow", "IsOffscreen", "No UI mutation sent"] {
            assert!(script.contains(token), "missing {token}");
        }
    }
    #[test]
    fn refuses_missing_or_invalid_os_process_creation_evidence() {
        for invalid in [r#"{"hwnd":901,"pid":123,"title":"Premiere","runtime_id":[1],"control_name":"Save","control_type":"Button"}"#,
            r#"{"hwnd":901,"pid":123,"process_start_ticks":0,"title":"Premiere","runtime_id":[1],"control_name":"Save","control_type":"Button"}"#,
            r#"{"hwnd":901,"pid":123,"process_start_ticks":-1,"title":"Premiere","runtime_id":[1],"control_name":"Save","control_type":"Button"}"#] {
            assert!(parse_prepared_control(invalid).is_err());
        }
        let mut t = target();
        t.process_start_ticks=0;
        assert!(guarded_mutation_root(Some("Premiere"), "$root=42".into(), Some(&t)).is_err());
    }
    #[test]
    fn denies_unbound_unsafe_and_invalid_control_actions() {
        assert!(guarded_mutation_root(Some("Premiere"), "$root=42".into(), None).is_err());
        let t = target();
        for window in [None, Some(""), Some("desktop"), Some("DESKTOP"), Some("Adobe\nPremiere")] {
            assert!(guarded_mutation_root(window, "$root=42".into(), Some(&t)).is_err());
        }
        let mut t = target();
        t.runtime_id.clear();
        assert!(guarded_mutation_root(Some("Premiere"), "$root=42".into(), Some(&t)).is_err());
    }
    #[test]
    fn modal_blocked_or_offscreen_application_roots_are_never_ui_targets() {
        let pre=prepared_control_probe("$root=42","$condition=1","ui_click").unwrap();
        assert!(pre.contains("Cannot bind disabled or offscreen native application root."));
        let executed=guarded_mutation_root(Some("Premiere"),"$root=42".into(),Some(&target())).unwrap();
        assert!(executed.contains("Prepared UIA owner window became disabled or offscreen"));
    }
    #[test]
    fn native_uia_approval_expires_after_one_minute_without_affecting_non_uia_actions() {
        use super::{expired_native_uia_binding,NATIVE_UIA_PREPARED_TTL_MS};
        let native = target();
        let start=2_000_000_u64;
        assert_eq!(NATIVE_UIA_PREPARED_TTL_MS,60_000);
        assert!(!expired_native_uia_binding(start,start+60_000,Some(&native)));
        assert!(expired_native_uia_binding(start,start+60_001,Some(&native)));
        assert!(expired_native_uia_binding(start,start-1,Some(&native)));
        assert!(!expired_native_uia_binding(start,start+600_000,None));
    }
    #[test]
    fn disallows_unknown_mutations_before_native_probe() {
        assert!(prepared_control_probe("$root=1", "$condition=1", "powershell").is_err());
        assert!(prepared_control_probe("$root=1", "$condition=1", "ui_find").is_err());
    }
    #[test]
    fn preflight_checks_exact_native_pattern_without_mutating_during_preparation() {
        let examples = [
            ("ui_click", "InvokePattern"),
            ("ui_set_value", "IsReadOnly"),
            ("ui_focus", "IsKeyboardFocusable"),
            ("ui_scroll", "VerticallyScrollable"),
            ("ui_toggle", "TogglePattern"),
            ("ui_expand_collapse", "ExpandCollapsePattern"),
            ("ui_send_keys", "IsKeyboardFocusable"),
        ];
        for (tool, check) in examples {
            let script=prepared_control_probe("$root=1", "$condition=1", tool).unwrap();
            assert!(script.contains(check), "{tool} missing {check}");
            assert!(!script.contains("__CAPABILITY_PREFLIGHT__"));
            assert!(!script.contains("SendWait("));
        }
    }

}
