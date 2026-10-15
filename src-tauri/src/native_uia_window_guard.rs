// Native UIA action binding. The trusted OS identity is captured by Rust
// during prepare_tool, stored ONLY in the Rust PendingAction and rechecked
// inside the same PowerShell invocation that performs a native mutation.
// Neither a model proposal nor the WebView is allowed to supply this binding.
use serde_json::Value;

#[derive(Debug, Clone)]
pub(super) struct NativeUiaTarget {
    pub(super) hwnd: i64,
    pub(super) pid: u32,
    pub(super) title: String,
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

// Used only at native PREPARE. The caller supplies a normal ui_root_script()
// which resolves exactly one real UIA top-level window. This probe performs
// the Win32 cross-check before emitting the trusted identity.
pub(super) fn prepared_window_probe(root_script: &str) -> String {
    format!(r#"Add-Type -AssemblyName UIAutomationClient
{root_script}
{WIN32_MUTATION_GUARD}
$shuviBoundHwnd = [IntPtr]([int64]$root.Current.NativeWindowHandle)
$shuviBoundPid = [int]$root.Current.ProcessId
if ($shuviBoundHwnd -eq [IntPtr]::Zero -or $shuviBoundPid -le 0 -or
    -not [ShuviUiaNativeIdentity]::IsWindow($shuviBoundHwnd) -or
    -not [ShuviUiaNativeIdentity]::IsWindowVisible($shuviBoundHwnd) -or
    [ShuviUiaNativeIdentity]::IsIconic($shuviBoundHwnd)) {{
 throw 'Cannot bind prepared UI action: top-level HWND absent, hidden or minimized.'
}}
[uint32]$shuviBoundNativePid = 0
[void][ShuviUiaNativeIdentity]::GetWindowThreadProcessId($shuviBoundHwnd,[ref]$shuviBoundNativePid)
if ($shuviBoundNativePid -eq 0 -or $shuviBoundNativePid -ne [uint32]$shuviBoundPid) {{
 throw 'Cannot bind prepared UI action: Win32 and UIA process differ.'
}}
$title = [string]$root.Current.Name
if ([string]::IsNullOrWhiteSpace($title)) {{ throw 'Cannot bind unnamed native UI window.' }}
@{{hwnd=[int64]$shuviBoundHwnd;pid=$shuviBoundPid;title=$title}} | ConvertTo-Json -Compress -Depth 2
"#)
}

pub(super) fn parse_prepared_window(output: &str) -> Result<NativeUiaTarget, String> {
    if output.len()>8192 { return Err("Prepared native HWND evidence exceeds limit.".into()); }
    let v: Value=serde_json::from_str(output.trim())
        .map_err(|_| "Prepared native HWND identity was not valid JSON.".to_string())?;
    let hwnd=v.get("hwnd").and_then(Value::as_i64).unwrap_or(0);
    let pid=v.get("pid").and_then(Value::as_u64).unwrap_or(0);
    let title=v.get("title").and_then(Value::as_str).unwrap_or("");
    if hwnd<=0 || pid==0 || pid>u32::MAX as u64 ||
       title.trim()!=title || title.is_empty() || title.chars().count()>180 ||
       title.chars().any(char::is_control) {
        return Err("Prepared native HWND/PID/title is missing or invalid.".into());
    }
    Ok(NativeUiaTarget{hwnd,pid:pid as u32,title:title.to_string()})
}

// Always reject a missing prepared OS identity, including if a stale action
// was restored without a binding. The executable PS invokes the Win32 check
// immediately before the UIA pattern method; no title-only fallback remains.
pub(super) fn guarded_mutation_root(
    window: Option<&str>,
    root_script: String,
    target: Option<&NativeUiaTarget>,
) -> Result<String, String> {
    let name=window.map(str::trim)
        .filter(|x| !x.is_empty() && x.chars().count()<=180)
        .ok_or_else(|| "UI mutation requires an explicit observed application window; never use desktop root.".to_string())?;
    if name.eq_ignore_ascii_case("desktop") || name.chars().any(char::is_control) {
        return Err("UI mutation cannot target desktop or a control-formatted window.".into());
    }
    let target=target.ok_or_else(|| "Native UIA mutation has no Rust-prepared HWND/PID identity; no action sent.".to_string())?;
    if target.hwnd<=0 || target.pid==0 || target.title.trim()!=target.title ||
       target.title.is_empty() || target.title.chars().count()>180 ||
       target.title.chars().any(char::is_control) {
        return Err("Rust-prepared UIA identity is invalid; no action sent.".into());
    }
    let title=target.title.replace('\'',"''");
    Ok(format!(r#"{root_script}
{WIN32_MUTATION_GUARD}
$shuviExpectedHwnd = [IntPtr]([int64]{})
$shuviExpectedPid = [uint32]{}
$shuviExpectedTitle = '{}'
function Assert-ShuviNativeTarget {{
 param($root, $element, [switch]$requireForeground)
 if ($shuviExpectedHwnd -eq [IntPtr]::Zero -or $shuviExpectedPid -eq 0 -or
     -not [ShuviUiaNativeIdentity]::IsWindow($shuviExpectedHwnd) -or
     -not [ShuviUiaNativeIdentity]::IsWindowVisible($shuviExpectedHwnd) -or
     [ShuviUiaNativeIdentity]::IsIconic($shuviExpectedHwnd)) {{
  throw 'Rust-prepared HWND is gone, hidden or minimized. No UI mutation sent.'
 }}
 [uint32]$nativePid = 0
 [void][ShuviUiaNativeIdentity]::GetWindowThreadProcessId($shuviExpectedHwnd, [ref]$nativePid)
 if ($nativePid -ne $shuviExpectedPid -or
     [int64]$root.Current.NativeWindowHandle -ne [int64]$shuviExpectedHwnd -or
     [int]$root.Current.ProcessId -ne [int]$shuviExpectedPid -or
     [string]$root.Current.Name -cne $shuviExpectedTitle) {{
  throw 'Prepared HWND/PID/title changed before execution. No UI mutation sent.'
 }}
 if ($null -eq $element -or
     [int]$element.Current.ProcessId -ne [int]$shuviExpectedPid -or
     [bool]$element.Current.IsOffscreen -or
     -not [bool]$element.Current.IsEnabled) {{
  throw 'Selected UIA control is foreign, disabled or offscreen. No UI mutation sent.'
 }}
 if ($requireForeground -and
     [ShuviUiaNativeIdentity]::GetForegroundWindow() -ne $shuviExpectedHwnd) {{
  throw 'Keyboard target is not the foreground HWND. No keys sent.'
 }}
}}
"#,target.hwnd,target.pid,title))
}

#[cfg(test)]
mod tests {
    use super::{NativeUiaTarget,guarded_mutation_root,parse_prepared_window,prepared_window_probe};
    fn approved()->NativeUiaTarget{ NativeUiaTarget{hwnd:901,pid:123,title:"Adobe Premiere Pro 2026".into()} }
    #[test]
    fn reject_missing_desktop_and_unbound_mutations() {
        let target=approved();
        for input in [None,Some(""),Some("desktop"),Some("DESKTOP"),Some("Adobe\nPremiere")] {
            assert!(guarded_mutation_root(input,"$root=42".into(),Some(&target)).is_err());
        }
        assert!(guarded_mutation_root(Some("Premiere"),"$root=42".into(),None).is_err());
    }
    #[test]
    fn prepared_window_parser_rejects_forged_and_malformed_identity() {
        for invalid in ["{}", "[]", "not-json", r#"{"hwnd":0,"pid":10,"title":"P"}"#,
            r#"{"hwnd":1,"pid":0,"title":"P"}"#,
            r#"{"hwnd":1,"pid":42,"title":"P\nQ"}"#,
            r#"{"hwnd":1,"pid":42,"title":" P"}"#] {
            assert!(parse_prepared_window(invalid).is_err());
        }
        let valid=parse_prepared_window(r#"{"hwnd":901,"pid":123,"title":"Premiere"}"#).unwrap();
        assert_eq!(valid.hwnd,901);
        assert_eq!(valid.pid,123);
    }
    #[test]
    fn prepare_probe_uses_real_native_win32_process_not_model_arguments() {
        let script=prepared_window_probe("$root=$observedNativeUiWindow");
        assert!(script.contains("GetWindowThreadProcessId"));
        assert!(script.contains("IsWindowVisible"));
        assert!(script.contains("ConvertTo-Json"));
        assert!(script.contains("$observedNativeUiWindow"));
    }
    #[test]
    fn execution_rechecks_same_prepared_identity_and_keyboard_foreground() {
        let script=guarded_mutation_root(Some("Adobe Premiere Pro 2026"),"$root=42".into(),Some(&approved())).unwrap();
        assert!(script.starts_with("$root=42\n"));
        for expected in ["[int64]901","[uint32]123","$shuviExpectedTitle",
            "GetWindowThreadProcessId","Assert-ShuviNativeTarget","GetForegroundWindow",
            "IsOffscreen","No UI mutation sent"] {
            assert!(script.contains(expected),"{expected} missing");
        }
    }
}
