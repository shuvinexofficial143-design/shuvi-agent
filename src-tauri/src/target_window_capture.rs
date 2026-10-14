// Capture the explicitly approved, observed app window instead of whichever app
// happens to be foreground while the owner is reviewing an Allow once prompt.
// This is a visible, consented capture: briefly activate the chosen window,
// verify the foreground HWND and PID, capture its exact on-screen rectangle,
// then restore the owner's previous foreground window. If Windows blocks focus
// or the target is ambiguous, fail closed and never send a different app image.
use super::{now_ms, prune_screenshot_dir, ps_single_quote, run_hidden_powershell, ui_root_script, MAX_SCREENSHOT_FILES};
use serde_json::Value;
use std::{fs, path::PathBuf};
use uuid::Uuid;

#[cfg(target_os = "windows")]
pub(super) fn capture_window_png(window: &str) -> Result<(PathBuf, String), String> {
    let dir = std::env::temp_dir().join("Shuvi").join("screenshots");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create screenshot directory: {error}"))?;
    let _ = prune_screenshot_dir(&dir, MAX_SCREENSHOT_FILES.saturating_sub(1));
    let path = dir.join(format!("screen-{}-{}.png", now_ms(), Uuid::new_v4()));
    let escaped_path = ps_single_quote(&path.to_string_lossy());
    let root_script = ui_root_script(Some(window));
    let script = r#"
Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
Add-Type -AssemblyName System.Drawing -ErrorAction Stop
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ShuviTargetCaptureWin32 {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ShowWindow(IntPtr hWnd, int command);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@ -ErrorAction Stop
__SHUVI_ROOT_SCRIPT__
$target = [IntPtr]([int64]$root.Current.NativeWindowHandle)
$title = [string]$root.Current.Name
$uiPid = [int]$root.Current.ProcessId
if ($target -eq [IntPtr]::Zero -or -not [ShuviTargetCaptureWin32]::IsWindow($target)) {
    throw 'The observed target window no longer exists. Re-run ui_windows.'
}
[uint32]$nativePid = 0
[void][ShuviTargetCaptureWin32]::GetWindowThreadProcessId($target, [ref]$nativePid)
if ($uiPid -le 0 -or $nativePid -ne [uint32]$uiPid) {
    throw 'Window identity changed before capture. Re-run ui_windows.'
}
$previous = [ShuviTargetCaptureWin32]::GetForegroundWindow()
try {
    if ([ShuviTargetCaptureWin32]::IsIconic($target)) {
        [void][ShuviTargetCaptureWin32]::ShowWindow($target, 9)  # SW_RESTORE
    }
    if ([ShuviTargetCaptureWin32]::GetForegroundWindow() -ne $target) {
        [void][ShuviTargetCaptureWin32]::SetForegroundWindow($target)
    }
    $focused = $false
    for ($attempt = 0; $attempt -lt 12; $attempt++) {
        Start-Sleep -Milliseconds 80
        if ([ShuviTargetCaptureWin32]::GetForegroundWindow() -eq $target) {
            $focused = $true
            break
        }
    }
    if (-not $focused) {
        throw 'Windows did not allow focusing the approved target window. No screenshot sent; do not capture Shuvi instead.'
    }
    $rect = New-Object ShuviTargetCaptureWin32+RECT
    if (-not [ShuviTargetCaptureWin32]::GetWindowRect($target, [ref]$rect)) {
        throw 'Could not read target window rectangle.'
    }
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -lt 160 -or $height -lt 100 -or $width -gt 16384 -or $height -gt 16384) {
        throw 'Target window bounds are invalid or too large to capture.'
    }
    $bounds = [System.Drawing.Rectangle]::new($rect.Left, $rect.Top, $width, $height)
    $desktop = [System.Windows.Forms.SystemInformation]::VirtualScreen
    if (-not $desktop.Contains($bounds)) {
        throw 'Target window extends outside the visible desktop; maximize or move it before retrying.'
    }
    $bitmap = New-Object System.Drawing.Bitmap $width, $height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bounds.Size)
        if ([ShuviTargetCaptureWin32]::GetForegroundWindow() -ne $target) {
            throw 'Foreground changed during capture. No screenshot sent.'
        }
        $bitmap.Save('__SHUVI_SCREENSHOT_PATH__', [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
    [PSCustomObject]@{
        Title = $title
        ProcessId = $uiPid
        NativeWindowHandle = [int64]$target
        Width = $width
        Height = $height
    } | ConvertTo-Json -Compress
} finally {
    if ($previous -ne [IntPtr]::Zero -and $previous -ne $target -and [ShuviTargetCaptureWin32]::IsWindow($previous)) {
        [void][ShuviTargetCaptureWin32]::SetForegroundWindow($previous)
    }
}
"#
        .replace("__SHUVI_ROOT_SCRIPT__", &root_script)
        .replace("__SHUVI_SCREENSHOT_PATH__", &escaped_path);
    let output = run_hidden_powershell(&script)
        .map_err(|error| format!("Target window capture failed: {error}"))?;
    if !output.status.success() || !path.exists() {
        let _ = fs::remove_file(&path);
        return Err(format!(
            "Target window capture did not complete. No image was sent: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let receipt: Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Target capture receipt invalid; no image sent: {error}"))?;
    let pid = receipt.get("ProcessId").and_then(Value::as_u64)
        .ok_or_else(|| "Target screenshot lacks verified process identity.".to_string())?;
    let hwnd = receipt.get("NativeWindowHandle").and_then(Value::as_i64)
        .ok_or_else(|| "Target screenshot lacks a window handle.".to_string())?;
    if fs::metadata(&path).map(|m| m.len()).unwrap_or(0) == 0 {
        return Err("Target screenshot is empty; no vision request was sent.".into());
    }
    let title = receipt.get("Title").and_then(Value::as_str).unwrap_or(window);
    Ok((path, format!("{} [PID {}, HWND {}]", title, pid, hwnd)))
}

#[cfg(not(target_os = "windows"))]
pub(super) fn capture_window_png(_window: &str) -> Result<(PathBuf, String), String> {
    Err("Target-window screenshot capture is available on Windows only.".into())
}
