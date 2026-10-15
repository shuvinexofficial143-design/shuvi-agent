// Capture the explicitly approved, observed app window instead of whichever app
// happens to be foreground while the owner is reviewing an Allow once prompt.
// This is a visible, consented capture: briefly activate the chosen window,
// verify the foreground HWND and PID, capture its exact on-screen rectangle,
// then restore the owner's previous foreground window. If Windows blocks focus
// or the target is ambiguous, fail closed and never send a different app image.
use super::{now_ms, prune_screenshot_dir, ps_single_quote, run_hidden_powershell, ui_root_script, MAX_SCREENSHOT_FILES};
use serde_json::Value;
use std::{fs, io::Read, path::PathBuf};
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
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X, Y; }
    [DllImport("user32.dll")]
    public static extern IntPtr WindowFromPoint(POINT point);
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
# No implicit restore: unminimizing an owner's app is an independent mutation.
if ([ShuviTargetCaptureWin32]::IsIconic($target) -or
    -not [ShuviTargetCaptureWin32]::IsWindowVisible($target)) {
    throw 'Target window minimized or hidden. No screenshot sent; restore manually.'
}
# Require physical pixel coordinates across mixed-DPI monitor layouts.
$previousDpi = [ShuviTargetCaptureWin32]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
if ($previousDpi -eq [IntPtr]::Zero) {
    throw 'Per-monitor DPI awareness unavailable. No screenshot sent.'
}
$previous = [ShuviTargetCaptureWin32]::GetForegroundWindow()
try {
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
    # Approval focus can stale UI Automation: revalidate target HWND and PID.
    [uint32]$pidAfterFocus = 0
    [void][ShuviTargetCaptureWin32]::GetWindowThreadProcessId($target, [ref]$pidAfterFocus)
    if (-not [ShuviTargetCaptureWin32]::IsWindow($target) -or
        -not [ShuviTargetCaptureWin32]::IsWindowVisible($target) -or
        [ShuviTargetCaptureWin32]::IsIconic($target) -or
        $pidAfterFocus -ne $nativePid -or
        [int64]$root.Current.NativeWindowHandle -ne [int64]$target -or
        [int]$root.Current.ProcessId -ne $uiPid) {
        throw 'Target identity changed after focus. No screenshot sent.'
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
    # Screen-copy captures visible pixels, including foreign topmost overlays.
    # Check representative interior samples and fail closed if another process
    # sits over the requested HWND (this is not a full occlusion proof).
    foreach ($sample in @('0.18,0.18','0.50,0.18','0.50,0.50','0.18,0.82','0.82,0.82')) {
        $fraction = $sample -split ','
        $point = New-Object ShuviTargetCaptureWin32+POINT
        $point.X = $rect.Left + [int][Math]::Floor($width * [double]::Parse($fraction[0], [Globalization.CultureInfo]::InvariantCulture))
        $point.Y = $rect.Top + [int][Math]::Floor($height * [double]::Parse($fraction[1], [Globalization.CultureInfo]::InvariantCulture))
        $hit = [ShuviTargetCaptureWin32]::WindowFromPoint($point)
        if ($hit -eq [IntPtr]::Zero) {
            throw 'Target visible surface not identifiable. No screenshot sent.'
        }
        [uint32]$hitPid = 0
        [void][ShuviTargetCaptureWin32]::GetWindowThreadProcessId($hit, [ref]$hitPid)
        if ($hitPid -ne $nativePid) {
            throw 'Foreign process occludes target. No screenshot sent.'
        }
    }
    $bitmap = New-Object System.Drawing.Bitmap $width, $height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bounds.Size)
        # Check focus, UIA identity, Win32 process and geometry after copying.
        [uint32]$pidAfterCopy = 0
        [void][ShuviTargetCaptureWin32]::GetWindowThreadProcessId($target, [ref]$pidAfterCopy)
        $afterRect = New-Object ShuviTargetCaptureWin32+RECT
        if (-not [ShuviTargetCaptureWin32]::IsWindow($target) -or
            -not [ShuviTargetCaptureWin32]::IsWindowVisible($target) -or
            [ShuviTargetCaptureWin32]::IsIconic($target) -or
            $pidAfterCopy -ne $nativePid -or
            [int64]$root.Current.NativeWindowHandle -ne [int64]$target -or
            [int]$root.Current.ProcessId -ne $uiPid -or
            [ShuviTargetCaptureWin32]::GetForegroundWindow() -ne $target -or
            -not [ShuviTargetCaptureWin32]::GetWindowRect($target, [ref]$afterRect) -or
            $afterRect.Left -ne $rect.Left -or $afterRect.Top -ne $rect.Top -or
            $afterRect.Right -ne $rect.Right -or $afterRect.Bottom -ne $rect.Bottom) {
            throw 'Target moved or changed identity during capture. No screenshot sent.'
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
        Left = $rect.Left
        Top = $rect.Top
    } | ConvertTo-Json -Compress
} finally {
    if ($previous -ne [IntPtr]::Zero -and $previous -ne $target -and [ShuviTargetCaptureWin32]::IsWindow($previous)) {
        [void][ShuviTargetCaptureWin32]::SetForegroundWindow($previous)
    }
    [void][ShuviTargetCaptureWin32]::SetThreadDpiAwarenessContext($previousDpi)
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
    // Validate PNG dimensions against a fresh HWND/PID-bound PowerShell receipt.
    // On any inconsistency, discard the screenshot instead of sending it to AI.
    let result = (|| -> Result<String, String> {
        let receipt: Value = serde_json::from_slice(&output.stdout)
            .map_err(|e| format!("Target capture receipt invalid; no image sent: {e}"))?;
        let size = fs::metadata(&path)
            .map_err(|e| format!("Screenshot missing; no image sent: {e}"))?.len();
        let mut header = [0_u8; 24];
        fs::File::open(&path).and_then(|mut f| f.read_exact(&mut header))
            .map_err(|e| format!("Screenshot header invalid; no image sent: {e}"))?;
        verify_capture_receipt(&receipt, &header, size)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&path);
    }
    result.map(|identity| (path, identity))
}

#[cfg(not(target_os = "windows"))]
pub(super) fn capture_window_png(_window: &str) -> Result<(PathBuf, String), String> {
    Err("Target-window screenshot capture is available on Windows only.".into())
}

fn png_dimensions(header: &[u8]) -> Result<(u32, u32), String> {
    if header.len() < 24 || &header[..8] != b"\x89PNG\r\n\x1a\n"
        || &header[8..12] != &[0, 0, 0, 13] || &header[12..16] != b"IHDR" {
        return Err("Screenshot PNG header invalid; no image sent.".into());
    }
    let width = u32::from_be_bytes(header[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(header[20..24].try_into().unwrap());
    if width == 0 || height == 0 || width > 16384 || height > 16384 {
        return Err("Screenshot PNG dimensions invalid; no image sent.".into());
    }
    Ok((width, height))
}

fn verify_capture_receipt(receipt: &Value, png: &[u8], bytes: u64) -> Result<String, String> {
    let title = receipt.get("Title").and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty() && s.len() <= 512 && !s.chars().any(char::is_control))
        .ok_or_else(|| "Target screenshot title invalid; no image sent.".to_string())?;
    let pid = receipt.get("ProcessId").and_then(Value::as_u64)
        .filter(|v| *v > 0 && *v <= u32::MAX as u64)
        .ok_or_else(|| "Target screenshot lacks verified process identity.".to_string())?;
    let hwnd = receipt.get("NativeWindowHandle").and_then(Value::as_i64)
        .filter(|v| *v > 0)
        .ok_or_else(|| "Target screenshot lacks valid window handle.".to_string())?;
    let width = receipt.get("Width").and_then(Value::as_u64)
        .ok_or_else(|| "Target screenshot missing measured width.".to_string())?;
    let height = receipt.get("Height").and_then(Value::as_u64)
        .ok_or_else(|| "Target screenshot missing measured height.".to_string())?;
    for key in ["Left", "Top"] {
        receipt.get(key).and_then(Value::as_i64)
            .ok_or_else(|| format!("Target screenshot missing physical {key}; no image sent."))?;
    }
    let (png_width, png_height) = png_dimensions(png)?;
    if bytes < 33 || width != u64::from(png_width) || height != u64::from(png_height) {
        return Err("Screenshot dimensions disagree with observed HWND; no image sent.".into());
    }
    Ok(format!("{} [PID {}, HWND {}]", title, pid, hwnd))
}

#[cfg(test)]
mod tests {
    use super::{png_dimensions, verify_capture_receipt};
    use serde_json::json;

    fn png_header(width: u32, height: u32) -> [u8; 24] {
        let mut bytes = [0_u8; 24];
        bytes[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        bytes[8..12].copy_from_slice(&13_u32.to_be_bytes());
        bytes[12..16].copy_from_slice(b"IHDR");
        bytes[16..20].copy_from_slice(&width.to_be_bytes());
        bytes[20..24].copy_from_slice(&height.to_be_bytes());
        bytes
    }
    fn receipt() -> serde_json::Value {
        json!({"Title":"Adobe Premiere Pro","ProcessId":451,"NativeWindowHandle":8122,
            "Width":1920,"Height":1080,"Left":-1920,"Top":0})
    }
    #[test]
    fn accepts_matching_png_and_observed_identity_with_negative_monitor_origin() {
        assert_eq!(png_dimensions(&png_header(1920, 1080)).unwrap(), (1920, 1080));
        assert!(verify_capture_receipt(&receipt(), &png_header(1920, 1080), 300000)
            .unwrap().contains("PID 451, HWND 8122"));
    }
    #[test]
    fn fails_closed_for_truncated_or_wrong_size_screenshots() {
        assert!(verify_capture_receipt(&receipt(), &png_header(1919, 1080), 300000).is_err());
        assert!(verify_capture_receipt(&receipt(), &png_header(1920, 1080), 12).is_err());
        let mut invalid = png_header(1920, 1080);
        invalid[0] = 0;
        assert!(verify_capture_receipt(&receipt(), &invalid, 300000).is_err());
    }
    #[test]
    fn fails_closed_for_invalid_or_missing_window_identity_and_geometry() {
        for patch in [json!({"ProcessId":0}), json!({"NativeWindowHandle":0}),
            json!({"Width":123}), json!({"Title":""}), json!({"Left":null})] {
            let mut broken = receipt();
            for (key, value) in patch.as_object().unwrap() { broken[key] = value.clone(); }
            assert!(verify_capture_receipt(&broken, &png_header(1920, 1080), 300000).is_err());
        }
    }
}
