// Native UIA mutation guard. This script executes in the SAME PowerShell
// process as the approved UIA action, immediately before its UIA pattern call.
// It does not invent an owner approval, action UUID or desktop lease.
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
$shuviExpectedHwnd = [IntPtr]([int64]$root.Current.NativeWindowHandle)
$shuviExpectedPid = [int]$root.Current.ProcessId
function Assert-ShuviNativeTarget {
 param($root, $element, [switch]$requireForeground)
 if ($shuviExpectedHwnd -eq [IntPtr]::Zero -or $shuviExpectedPid -le 0) {
  throw 'No positive HWND/PID for approved UI window. No UI mutation sent.'
 }
 if (-not [ShuviUiaNativeIdentity]::IsWindow($shuviExpectedHwnd) -or
     -not [ShuviUiaNativeIdentity]::IsWindowVisible($shuviExpectedHwnd) -or
     [ShuviUiaNativeIdentity]::IsIconic($shuviExpectedHwnd)) {
  throw 'Approved HWND is gone, hidden or minimized. No UI mutation sent.'
 }
 [uint32]$nativePid = 0
 [void][ShuviUiaNativeIdentity]::GetWindowThreadProcessId($shuviExpectedHwnd, [ref]$nativePid)
 if ($nativePid -eq 0 -or $nativePid -ne [uint32]$shuviExpectedPid -or
     [int64]$root.Current.NativeWindowHandle -ne [int64]$shuviExpectedHwnd -or
     [int]$root.Current.ProcessId -ne $shuviExpectedPid) {
  throw 'UIA HWND/PID changed relative to native Win32. No UI mutation sent.'
 }
 # Every selected control is resolved as a descendant of this exact UIA root.
 # A cross-process UIA element is not authorized merely by a shared caption.
 if ($null -eq $element -or
     [int]$element.Current.ProcessId -ne $shuviExpectedPid -or
     [bool]$element.Current.IsOffscreen -or
     -not [bool]$element.Current.IsEnabled) {
  throw 'Selected UIA control is foreign, disabled or offscreen. No UI mutation sent.'
 }
 if ($requireForeground -and
     [ShuviUiaNativeIdentity]::GetForegroundWindow() -ne $shuviExpectedHwnd) {
  throw 'Keyboard target is not the foreground HWND. No keys sent.'
 }
}
"#;

// Called only for *mutating* UIA tools. Read-only ui_find/ui_discover keep
// their existing semantic matching, but can never become mutation permission.
pub(super) fn guarded_mutation_root(
    window: Option<&str>,
    root_script: String,
) -> Result<String, String> {
    let name = window
        .map(str::trim)
        .filter(|name| !name.is_empty() && name.chars().count() <= 180)
        .ok_or_else(|| {
            "UI mutation requires an explicit observed application window; never use desktop root."
                .to_string()
        })?;
    if name.eq_ignore_ascii_case("desktop") || name.chars().any(char::is_control) {
        return Err("UI mutation cannot target desktop or a control-formatted window.".into());
    }
    Ok(format!("{root_script}\n{WIN32_MUTATION_GUARD}"))
}

#[cfg(test)]
mod tests {
    use super::guarded_mutation_root;

    #[test]
    fn reject_missing_desktop_and_formatted_window_before_mutation() {
        for input in [None, Some(""), Some("   "), Some("desktop"), Some("DESKTOP"), Some("Adobe\nPremiere")] {
            assert!(guarded_mutation_root(input, "$root=42".to_owned()).is_err());
        }
        assert!(guarded_mutation_root(Some(&"x".repeat(181)), "".into()).is_err());
    }
    #[test]
    fn preserve_root_selector_with_native_runtime_identity_guard() {
        let script=guarded_mutation_root(Some("Adobe Premiere Pro 2026"), "$root=42".into()).unwrap();
        assert!(script.starts_with("$root=42\n"));
        for required in ["IsWindowVisible", "IsIconic", "GetWindowThreadProcessId",
            "Assert-ShuviNativeTarget", "GetForegroundWindow", "IsOffscreen",
            "No UI mutation sent"] {
            assert!(script.contains(required), "missing {required}");
        }
    }
}
