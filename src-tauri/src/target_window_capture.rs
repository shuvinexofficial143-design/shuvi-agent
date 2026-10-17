// Capture the explicitly approved, observed app window instead of whichever app
// happens to be foreground while the owner is reviewing an Allow once prompt.
// This is a visible, consented capture: briefly activate the chosen window,
// verify the foreground HWND and PID, capture its exact on-screen rectangle,
// then restore the owner's previous foreground window. If Windows blocks focus
// or the target is ambiguous, fail closed and never send a different app image.
use super::{now_ms, ps_single_quote, run_hidden_powershell, ui_root_script};
use serde_json::Value;
use std::{fs, io::Read, path::{Path, PathBuf}};

// Bounding the PNG on disk also bounds screenshot integrity verification
// without allocating a second full-resolution bitmap in Shuvi's process.
const MAX_CAPTURE_PNG_BYTES: u64 = 96 * 1024 * 1024;
// ~148 MiB raw BGRA bitmap at most. Stops giant 16k x 16k GDI allocations.
const MAX_CAPTURE_PIXELS: u64 = 36_864_000;
use uuid::Uuid;

// Distinguish short-lived AI vision artifacts from deliberate user
// capture_screen files. Only expired vision-*.png files *within Shuvi's
// one controlled directory* may be scavenged. Symlinks and directories
// are never followed or deleted; active captures have a wide grace period.
const STALE_VISION_CAPTURE_AGE: std::time::Duration =
    std::time::Duration::from_secs(15 * 60);

fn prune_stale_vision_captures(dir: &Path) -> Result<usize, String> {
    let now = std::time::SystemTime::now();
    let mut removed = 0;
    let entries = fs::read_dir(dir)
        .map_err(|e| format!("Vision screenshot cleanup directory unavailable: {e}"))?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue; };
        if !name.starts_with("vision-") || !name.ends_with(".png") { continue; }
        if !entry.file_type().is_ok_and(|kind| kind.is_file()) { continue; }
        let Ok(modified) = entry.metadata().and_then(|m| m.modified()) else {
            continue;
        };
        if now.duration_since(modified)
            .is_ok_and(|elapsed| elapsed >= STALE_VISION_CAPTURE_AGE)
            && fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}



// OS-derived, action-local window identity captured BEFORE owner approval.
// Neither AI nor WebView may choose HWND, PID or process birth generation.
#[derive(Debug, Clone)]
pub(super) struct PreparedCaptureTarget {
    hwnd: i64,
    pid: u32,
    process_start_ticks: i64,
    title: String,
}
const PREPARED_CAPTURE_TTL_MS: u64 = 60_000;

pub(super) fn expired_capture_binding(
    prepared_at_ms: u64, now_ms: u64, target: Option<&PreparedCaptureTarget>
) -> bool {
    target.is_some() && (now_ms < prepared_at_ms
        || now_ms - prepared_at_ms > PREPARED_CAPTURE_TTL_MS)
}

fn parse_prepared_capture(output: &str, expected_title: &str)
    -> Result<PreparedCaptureTarget, String>
{
    if output.len() > 2048 {
        return Err("Prepared screenshot window evidence too large.".into());
    }
    let value: Value = serde_json::from_str(output.trim())
        .map_err(|_| "Prepared screenshot window identity not valid JSON.".to_string())?;
    let hwnd = value.get("hwnd").and_then(Value::as_i64).unwrap_or(0);
    let pid = value.get("pid").and_then(Value::as_u64).unwrap_or(0);
    let process_start_ticks = value.get("process_start_ticks")
        .and_then(Value::as_i64).unwrap_or(0);
    let title = value.get("title").and_then(Value::as_str).unwrap_or("");
    if hwnd <= 0 || pid == 0 || pid > u32::MAX as u64
        || process_start_ticks <= 0
        || expected_title.is_empty() || expected_title.chars().count() > 180
        || expected_title.trim() != expected_title
        || expected_title.chars().any(char::is_control)
        || title.is_empty() || title.chars().count() > 180
        || title.trim() != title || title.chars().any(char::is_control)
    {
        return Err("Prepared screenshot HWND/PID/process generation is invalid.".into());
    }
    Ok(PreparedCaptureTarget {
        hwnd, pid: pid as u32, process_start_ticks, title: title.into()
    })
}

#[cfg(target_os = "windows")]
pub(super) fn prepare_window_capture(window: &str)
    -> Result<Option<PreparedCaptureTarget>, String>
{
    if window.is_empty() || window.chars().count() > 180 ||
       window.trim() != window || window.chars().any(char::is_control) ||
       window.eq_ignore_ascii_case("desktop") {
        return Err("Target screenshot requires one exact named application window.".into());
    }
    let root = ui_root_script(Some(window));
    let attestation = super::native_uia_window_guard::readonly_window_attestation_script();
    // The native read-only root must be the *same* window before/after the
    // probe; do not accept a model supplied HWND or a title-only approval.
    let script = format!(
        "Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop\n\
         {root}\n{attestation}\n\
         Assert-ShuviObservedWindow\n\
         [PSCustomObject]@{{\
         hwnd=[int64]$shuviReadHwnd;\
         pid=[uint32]$shuviReadPid;\
         process_start_ticks=[int64]$shuviReadStartTicks;\
         title=[string]$shuviReadTitle\
         }} | ConvertTo-Json -Compress -Depth 2"
    );
    let output = run_hidden_powershell(&script)?;
    if !output.status.success() {
        return Err("Approved screenshot window could not be uniquely bound at preparation.".into());
    }
    let text = std::str::from_utf8(&output.stdout)
        .map_err(|_| "Screenshot target OS evidence is not UTF-8.".to_string())?;
    Ok(Some(parse_prepared_capture(text,window)?))
}

#[cfg(not(target_os = "windows"))]
pub(super) fn prepare_window_capture(_window: &str)
    -> Result<Option<PreparedCaptureTarget>, String>
{
    // Source tests on Linux do not invent Windows OS evidence.
    Ok(None)
}

#[cfg(target_os = "windows")]
pub(super) fn capture_window_png(
    window: &str, expected: Option<&PreparedCaptureTarget>
) -> Result<(PathBuf, String), String> {
    let target = expected.ok_or_else(||
        "Screenshot action was not bound to a Windows HWND/PID before approval.".to_string())?;
    if target.hwnd <= 0 || target.pid == 0 || target.process_start_ticks <= 0 ||
       target.title.is_empty() || target.title.chars().count() > 180 ||
       target.title.trim() != target.title || target.title.chars().any(char::is_control) ||
       window.is_empty() || window.chars().count() > 180 ||
       window.chars().any(char::is_control) || window.trim() != window {
        return Err("Approved screenshot target identity is malformed or replaced.".into());
    }
    let dir = std::env::temp_dir().join("Shuvi").join("screenshots");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create screenshot directory: {error}"))?;
    // Best-effort cleanup of orphaned *ephemeral* vision captures from
    // interrupted earlier runs. Never touch deliberately saved screen-*.png.
    let _ = prune_stale_vision_captures(&dir);
    let path = dir.join(format!("vision-{}-{}.png", now_ms(), Uuid::new_v4()));
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
    // GA_ROOT follows the actual parent window chain. Owner/GA_ROOTOWNER
    // would wrongly bless a separate same-process popup owned by the target.
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@ -ErrorAction Stop
__SHUVI_ROOT_SCRIPT__
$shuviExpectedCaptureHwnd = [int64]__SHUVI_APPROVED_HWND__
$shuviExpectedCapturePid = [uint32]__SHUVI_APPROVED_PID__
$shuviExpectedCaptureStartTicks = [int64]__SHUVI_APPROVED_BIRTH__
$shuviExpectedCaptureTitle = '__SHUVI_APPROVED_TITLE__'
$target = [IntPtr]([int64]$root.Current.NativeWindowHandle)
$title = [string]$root.Current.Name
$uiPid = [int]$root.Current.ProcessId
# A new app with the SAME window title cannot inherit a prior approval.
if ([int64]$target -ne $shuviExpectedCaptureHwnd -or
    $uiPid -ne [int]$shuviExpectedCapturePid -or
    $title -cne $shuviExpectedCaptureTitle) {
    throw 'Window target changed after owner approval. No screenshot sent.'
}
if ($target -eq [IntPtr]::Zero -or -not [ShuviTargetCaptureWin32]::IsWindow($target)) {
    throw 'The observed target window no longer exists. Re-run ui_windows.'
}
[uint32]$nativePid = 0
[void][ShuviTargetCaptureWin32]::GetWindowThreadProcessId($target, [ref]$nativePid)
if ($uiPid -le 0 -or $nativePid -ne [uint32]$uiPid) {
    throw 'Window identity changed before capture. Re-run ui_windows.'
}
# OS process birth-time binds the exact app instance, not just numeric PID
# and HWND values, which Windows may recycle after an application restart.
try {
    $shuviCaptureProcess = Get-Process -Id $uiPid -ErrorAction Stop
    [int64]$shuviCaptureStartTicks = $shuviCaptureProcess.StartTime.ToUniversalTime().Ticks
} catch {
    throw 'Cannot establish original app process start time; no screenshot sent.'
}
if ($shuviCaptureStartTicks -le 0 -or
    $shuviCaptureStartTicks -ne $shuviExpectedCaptureStartTicks) {
    throw 'Invalid app process generation; no screenshot sent. Approved app process generation changed before screenshot.'
}
function Assert-ShuviCaptureProcessGeneration {
    try {
        $process = Get-Process -Id $uiPid -ErrorAction Stop
        [int64]$liveStartTicks = $process.StartTime.ToUniversalTime().Ticks
    } catch {
        throw 'Captured application process exited; no screenshot sent.'
    }
    if ($liveStartTicks -ne $shuviCaptureStartTicks -or
        $liveStartTicks -ne $shuviExpectedCaptureStartTicks) {
        throw 'Application process restarted during window capture. No screenshot sent.'
    }
}
Assert-ShuviCaptureProcessGeneration
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
    Assert-ShuviCaptureProcessGeneration
    $rect = New-Object ShuviTargetCaptureWin32+RECT
    if (-not [ShuviTargetCaptureWin32]::GetWindowRect($target, [ref]$rect)) {
        throw 'Could not read target window rectangle.'
    }
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -lt 160 -or $height -lt 100 -or $width -gt 16384 -or $height -gt 16384) {
        throw 'Target window bounds are invalid or too large to capture.'
    }
    # Check bitmap RAM allocation size BEFORE New-Object Bitmap or any
    # potentially expensive screen-copy operation.
    if (([int64]$width * [int64]$height) -gt 36864000) {
        throw 'Target screenshot exceeds the bounded 36.9 megapixel capture budget. No image sent.'
    }
    $bounds = [System.Drawing.Rectangle]::new($rect.Left, $rect.Top, $width, $height)
    $desktop = [System.Windows.Forms.SystemInformation]::VirtualScreen
    if (-not $desktop.Contains($bounds)) {
        throw 'Target window extends outside the visible desktop; maximize or move it before retrying.'
    }
    # Screen-copy captures visible pixels, including foreign topmost overlays.
    # Check representative interior samples and fail closed if another process
    # sits over the requested HWND (this is not a full occlusion proof).
    function Assert-ShuviCaptureSurface {
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
        # Matching process ID is insufficient: a separate modal, owned
        # popup or floating top-level dialog from the SAME application
        # can still cover the target while the target HWND stays visible.
        # Child controls in the requested root remain valid.
        $hitRoot = [ShuviTargetCaptureWin32]::GetAncestor($hit, [uint32]2)
        if ($hitRoot -eq [IntPtr]::Zero -or $hitRoot -ne $target) {
            throw 'Another top-level window covers the approved screenshot target. No image sent.'
        }
    }
    }
    # Sample visible target ownership both before and after the bitmap copy.
    # This does not prove every pixel but rejects common popup/overlay races.
    Assert-ShuviCaptureSurface
    $bitmap = New-Object System.Drawing.Bitmap $width, $height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bounds.Size)
        # Foreign dialogs may appear between the first occlusion check and
        # CopyFromScreen. Discard the image before persisting it if samples
        # now hit a different window owner.
        Assert-ShuviCaptureSurface
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
        Assert-ShuviCaptureProcessGeneration
        $bitmap.Save('__SHUVI_SCREENSHOT_PATH__', [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
    # The screenshot can take time to encode. An app may move, close, get
    # covered or change UIA root AFTER CopyFromScreen and Bitmap.Save.
    # Treat that saved image as untrusted until the original window/rect
    # and visible sampled surface are independently rechecked.
    [uint32]$pidAfterSave = 0
    [void][ShuviTargetCaptureWin32]::GetWindowThreadProcessId($target, [ref]$pidAfterSave)
    $finalRect = New-Object ShuviTargetCaptureWin32+RECT
    if (-not [ShuviTargetCaptureWin32]::IsWindow($target) -or
        -not [ShuviTargetCaptureWin32]::IsWindowVisible($target) -or
        [ShuviTargetCaptureWin32]::IsIconic($target) -or
        $pidAfterSave -ne $nativePid -or
        [int64]$root.Current.NativeWindowHandle -ne [int64]$target -or
        [int]$root.Current.ProcessId -ne $uiPid -or
        [string]$root.Current.Name -cne $title -or
        [ShuviTargetCaptureWin32]::GetForegroundWindow() -ne $target -or
        -not [ShuviTargetCaptureWin32]::GetWindowRect($target, [ref]$finalRect) -or
        $finalRect.Left -ne $rect.Left -or $finalRect.Top -ne $rect.Top -or
        $finalRect.Right -ne $rect.Right -or $finalRect.Bottom -ne $rect.Bottom) {
        throw 'Approved target changed after screenshot encoding. No image sent.'
    }
    Assert-ShuviCaptureProcessGeneration
    Assert-ShuviCaptureSurface
    # Rust deletes any saved PNG if this final attestation fails.
    [PSCustomObject]@{
        Title = $title
        ProcessId = $uiPid
        ProcessStartTicks = [int64]$shuviCaptureStartTicks
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
        .replace("__SHUVI_SCREENSHOT_PATH__", &escaped_path)
        .replace("__SHUVI_APPROVED_HWND__", &target.hwnd.to_string())
        .replace("__SHUVI_APPROVED_PID__", &target.pid.to_string())
        .replace("__SHUVI_APPROVED_BIRTH__", &target.process_start_ticks.to_string())
        .replace("__SHUVI_APPROVED_TITLE__", &ps_single_quote(&target.title));
    let output = match run_hidden_powershell(&script) {
        Ok(output) => output,
        Err(error) => {
            // A failed/interrupted PowerShell invocation may have saved a
            // sensitive screenshot before erroring. Never leave it behind.
            let _ = fs::remove_file(&path);
            return Err(format!("Target window capture failed: {error}"));
        }
    };
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
        let identity = verify_capture_receipt(&receipt, &header, size)?;
        // ImageFormat.Png output must be complete, CRC-checked and bounded.
        // A plausible 24-byte header is not sufficient to send pixels to AI.
        verify_png_structure(fs::File::open(&path)
            .map_err(|e| format!("Screenshot unreadable; no image sent: {e}"))?, size)?;
        Ok(identity)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&path);
    }
    result.map(|identity| (path, identity))
}

#[cfg(not(target_os = "windows"))]
pub(super) fn capture_window_png(
    _window: &str, _expected: Option<&PreparedCaptureTarget>
) -> Result<(PathBuf, String), String> {
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


// CRC-32 of a PNG chunk (IEEE polynomial). Checked incrementally so a
// maliciously large output never needs to be held entirely in memory.
fn png_crc_update(mut crc: u32, bytes: &[u8]) -> u32 {
    for &byte in bytes {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 { (crc >> 1) ^ 0xedb8_8320 } else { crc >> 1 };
        }
    }
    crc
}

// Validates the PNG container emitted by Windows System.Drawing, not pixels
// or an Adobe editing outcome. Rejects truncated/corrupt/oversize files,
// impossible chunk order, duplicate IHDR, empty data and trailing payload.
fn verify_png_structure(mut reader: impl Read, bytes: u64) -> Result<(), String> {
    if bytes < 57 || bytes > MAX_CAPTURE_PNG_BYTES {
        return Err("Screenshot file size out of bounds; no image sent.".into());
    }
    let mut signature = [0_u8; 8];
    reader.read_exact(&mut signature)
        .map_err(|_| "Screenshot PNG signature missing; no image sent.".to_string())?;
    if &signature != b"\x89PNG\r\n\x1a\n" {
        return Err("Screenshot PNG signature invalid; no image sent.".into());
    }
    let mut pos = 8_u64;
    let mut seen_ihdr = false;
    let mut seen_idat = false;
    let mut finished_idat = false;
    let mut chunk_count = 0_u32;
    let mut buffer = [0_u8; 64 * 1024];
    while pos < bytes {
        chunk_count += 1;
        if chunk_count > 10_000 || bytes - pos < 12 {
            return Err("Screenshot PNG chunk boundary invalid; no image sent.".into());
        }
        let mut chunk_header = [0_u8; 8];
        reader.read_exact(&mut chunk_header)
            .map_err(|_| "Screenshot PNG chunk header truncated; no image sent.".to_string())?;
        let len = u64::from(u32::from_be_bytes(chunk_header[..4].try_into().unwrap()));
        let kind = &chunk_header[4..8];
        if len > bytes - pos - 12 || !kind.iter().all(u8::is_ascii_alphabetic) {
            return Err("Screenshot PNG chunk length/type invalid; no image sent.".into());
        }
        if kind == b"IHDR" {
            if seen_ihdr || chunk_count != 1 || len != 13 {
                return Err("Screenshot has duplicate or malformed IHDR; no image sent.".into());
            }
            seen_ihdr = true;
        } else if !seen_ihdr {
            return Err("Screenshot PNG lacks first IHDR; no image sent.".into());
        } else if kind == b"IDAT" {
            if finished_idat || len == 0 {
                return Err("Screenshot PNG image data invalid; no image sent.".into());
            }
            seen_idat = true;
        } else if kind == b"IEND" {
            if !seen_idat || len != 0 || pos + 12 != bytes {
                return Err("Screenshot PNG missing clean final IEND; no image sent.".into());
            }
        } else {
            if seen_idat { finished_idat = true; }
            // Accept permitted ancillary metadata, and PLTE only before
            // IDAT. Unknown *critical* chunks are unsafe to interpret.
            if kind == b"PLTE" {
                if seen_idat { return Err("Screenshot PNG palette after image data.".into()); }
            } else if kind[0] & 0x20 == 0 {
                return Err("Screenshot contains unknown critical PNG chunk.".into());
            }
        }
        let mut crc = png_crc_update(!0_u32, kind);
        let mut remaining = len;
        while remaining > 0 {
            let n = (remaining as usize).min(buffer.len());
            reader.read_exact(&mut buffer[..n])
                .map_err(|_| "Screenshot PNG chunk data truncated; no image sent.".to_string())?;
            crc = png_crc_update(crc, &buffer[..n]);
            remaining -= n as u64;
        }
        let mut saved = [0_u8; 4];
        reader.read_exact(&mut saved)
            .map_err(|_| "Screenshot PNG chunk checksum truncated; no image sent.".to_string())?;
        if !crc != u32::from_be_bytes(saved) {
            return Err("Screenshot PNG CRC mismatch; no image sent.".into());
        }
        pos += len + 12;
        if kind == b"IEND" { return Ok(()); }
    }
    Err("Screenshot missing final PNG IEND; no image sent.".into())
}

// Explicit desktop captures have no app-specific HWND identity, but they
// still must be bounded and structurally trustworthy before being retained
// for manual viewing or used by AI. This is a PNG container/CRC check, not
// proof of live Windows pixel content or zlib decompression.
// Validate the exact bounded in-memory PNG bytes that are about to be
// submitted for a separately approved vision request. The file may have
// changed after earlier disk verification, so do not trust only the signature
// or CRC of the *previously* captured file.
pub(super) fn verify_vision_png_bytes(bytes: &[u8]) -> Result<(), String> {
    let (width,height) = png_dimensions(bytes)?;
    if u64::from(width).checked_mul(u64::from(height))
        .is_none_or(|pixels| pixels > MAX_CAPTURE_PIXELS) {
        return Err("Vision screenshot exceeds decoded bitmap pixel budget.".into());
    }
    verify_png_structure(std::io::Cursor::new(bytes),bytes.len() as u64)
}

pub(super) fn verify_unbound_desktop_png(path: &Path) -> Result<(), String> {
    let bytes = fs::metadata(path)
        .map_err(|e| format!("Desktop screenshot missing; no image sent: {e}"))?.len();
    let mut header=[0_u8;24];
    fs::File::open(path).and_then(|mut file| file.read_exact(&mut header))
        .map_err(|e| format!("Desktop screenshot PNG header unreadable: {e}"))?;
    let (width,height)=png_dimensions(&header)?;
    if u64::from(width).checked_mul(u64::from(height))
        .is_none_or(|pixels| pixels > MAX_CAPTURE_PIXELS) {
        return Err("Desktop screenshot exceeds raw bitmap pixel budget.".into());
    }
    verify_png_structure(fs::File::open(path)
        .map_err(|e| format!("Desktop screenshot unreadable: {e}"))?,bytes)
}

fn verify_capture_receipt(receipt: &Value, png: &[u8], bytes: u64) -> Result<String, String> {
    let title = receipt.get("Title").and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty() && s.len() <= 512 && !s.chars().any(char::is_control))
        .ok_or_else(|| "Target screenshot title invalid; no image sent.".to_string())?;
    let pid = receipt.get("ProcessId").and_then(Value::as_u64)
        .filter(|v| *v > 0 && *v <= u32::MAX as u64)
        .ok_or_else(|| "Target screenshot lacks verified process identity.".to_string())?;
    let birth_ticks = receipt.get("ProcessStartTicks").and_then(Value::as_i64)
        .filter(|v| *v > 0)
        .ok_or_else(|| "Target screenshot lacks verified OS process generation; no image sent.".to_string())?;
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
    if width.checked_mul(height).is_none_or(|pixels| pixels > MAX_CAPTURE_PIXELS) {
        return Err("Screenshot pixel budget exceeded; no image sent.".into());
    }
    // Avoid exporting the raw birth tick value to the model; validation is
    // performed here in Rust before publishing the target identity label.
    let _ = birth_ticks;
    Ok(format!("{} [PID {}, HWND {}]", title, pid, hwnd))
}

#[cfg(test)]
mod tests {
    use super::{png_crc_update, png_dimensions, verify_capture_receipt, verify_png_structure,
                parse_prepared_capture, expired_capture_binding, verify_unbound_desktop_png, verify_vision_png_bytes,
                prune_stale_vision_captures};
    use std::io::Cursor;
    use serde_json::json;

    // The CRC tests use a tiny synthetic PNG container, not a desktop shot.
    // IDAT contents are intentionally artificial: this test checks structure
    // and checksum, not zlib pixel decoding or application acceptance.
    fn chunk(name: &[u8; 4], data: &[u8]) -> Vec<u8> {
        let mut output = Vec::new();
        output.extend_from_slice(&(data.len() as u32).to_be_bytes());
        output.extend_from_slice(name);
        output.extend_from_slice(data);
        let mut crc = png_crc_update(!0_u32, name);
        crc = png_crc_update(crc, data);
        output.extend_from_slice(&(!crc).to_be_bytes());
        output
    }
    fn sample_png() -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        let mut ihdr = Vec::new();
        ihdr.extend_from_slice(&2_u32.to_be_bytes());
        ihdr.extend_from_slice(&2_u32.to_be_bytes());
        ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
        bytes.extend(chunk(b"IHDR", &ihdr));
        bytes.extend(chunk(b"IDAT", &[1, 2, 3, 4]));
        bytes.extend(chunk(b"IEND", &[]));
        bytes
    }
    #[test]
    fn png_structure_accepts_bounded_complete_crc_valid_container() {
        let bytes = sample_png();
        assert!(verify_png_structure(Cursor::new(&bytes), bytes.len() as u64).is_ok());
    }
    #[test]
    fn png_structure_rejects_corrupted_crc_truncated_data_or_trailing_bytes() {
        let valid = sample_png();
        let mut corrupt = valid.clone();
        corrupt[45] ^= 0x40;
        assert!(verify_png_structure(Cursor::new(&corrupt), corrupt.len() as u64).is_err());
        for n in [8, 24, valid.len()-1] {
            assert!(verify_png_structure(Cursor::new(&valid[..n]), n as u64).is_err());
        }
        let mut trailing = valid.clone();
        trailing.push(17);
        assert!(verify_png_structure(Cursor::new(&trailing), trailing.len() as u64).is_err());
    }
    #[test]
    fn png_structure_rejects_duplicate_header_unknown_critical_and_oversize() {
        let valid = sample_png();
        let mut duplicated = valid[..33].to_vec();
        duplicated.extend(chunk(b"IHDR", &valid[16..29]));
        duplicated.extend_from_slice(&valid[33..]);
        assert!(verify_png_structure(Cursor::new(&duplicated), duplicated.len() as u64).is_err());
        let mut unknown = valid[..33].to_vec();
        unknown.extend(chunk(b"ABCD", &[1]));
        unknown.extend_from_slice(&valid[33..]);
        assert!(verify_png_structure(Cursor::new(&unknown), unknown.len() as u64).is_err());
        assert!(verify_png_structure(Cursor::new(&valid), 96*1024*1024+1).is_err());
    }
    #[test]
    fn prepared_screenshot_identity_parses_signed_os_evidence_only() {
        let proof = r#"{"hwnd":7711,"pid":123,"process_start_ticks":638962980000000000,"title":"Adobe Premiere Pro"}"#;
        let parsed = parse_prepared_capture(proof,"Adobe Premiere Pro").unwrap();
        assert_eq!((parsed.hwnd,parsed.pid,parsed.process_start_ticks),
            (7711,123,638962980000000000));
        // The canonical OS caption can differ from the requested unique
        // application alias. Root resolver already enforces uniqueness.
        assert!(parse_prepared_capture(proof,"Premiere").is_ok());
        assert!(parse_prepared_capture(proof," Blender ").is_err());
        for bad in ["{}", "[]", "not json",
            r#"{"hwnd":7711,"pid":123,"process_start_ticks":0,"title":"Adobe Premiere Pro"}"#,
            r#"{"hwnd":7711,"pid":0,"process_start_ticks":123,"title":"Adobe Premiere Pro"}"#,
            r#"{"hwnd":-1,"pid":123,"process_start_ticks":123,"title":"Adobe Premiere Pro"}"#,
            r#"{"hwnd":7711,"pid":123,"process_start_ticks":123,"title":"Adobe Premiere Pro\n"}"#
        ] {
            assert!(parse_prepared_capture(bad,"Adobe Premiere Pro").is_err(),"{bad}");
        }
    }
    #[test]
    fn capture_identity_expires_after_one_minute_without_affecting_other_tools() {
        let proof = r#"{"hwnd":7711,"pid":123,"process_start_ticks":638962980000000000,"title":"Adobe Premiere Pro"}"#;
        let binding = parse_prepared_capture(proof,"Adobe Premiere Pro").unwrap();
        assert!(!expired_capture_binding(1000,61000,Some(&binding)));
        assert!(expired_capture_binding(1000,61001,Some(&binding)));
        assert!(expired_capture_binding(1000,999,Some(&binding)));
        assert!(!expired_capture_binding(1000,900000,None));
    }

    #[test]
    fn stale_vision_cleanup_never_removes_manual_or_recent_capture_files() {
        use std::time::{Duration, SystemTime};
        let dir=std::env::temp_dir().join(format!(
            "shuvi39-vision-prune-{}-{}",std::process::id(),uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let old_vision=dir.join("vision-expired.png");
        let old_manual=dir.join("screen-user-saved.png");
        let recent_vision=dir.join("vision-active.png");
        let wrong_extension=dir.join("vision-not-image.txt");
        for path in [&old_vision,&old_manual,&recent_vision,&wrong_extension] {
            std::fs::write(path,b"test").unwrap();
        }
        let stale=SystemTime::now()-Duration::from_secs(3600);
        let times=std::fs::FileTimes::new().set_modified(stale);
        for path in [&old_vision,&old_manual,&wrong_extension] {
            std::fs::File::open(path).unwrap().set_times(times).unwrap();
        }
        assert_eq!(prune_stale_vision_captures(&dir).unwrap(),1);
        assert!(!old_vision.exists());
        assert!(old_manual.exists());
        assert!(recent_vision.exists());
        assert!(wrong_extension.exists());
        for path in [&old_manual,&recent_vision,&wrong_extension] {
            std::fs::remove_file(path).unwrap();
        }
        std::fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn vision_scavenger_wont_remove_nonexistent_directory() {
        let dir=std::env::temp_dir().join(format!(
            "shuvi39-no-vision-folder-{}",uuid::Uuid::new_v4()));
        assert!(prune_stale_vision_captures(&dir).is_err());
    }

    #[test]
    fn in_memory_vision_upload_checks_exact_png_bytes_not_stale_disk_header() {
        let valid=sample_png();
        assert!(verify_vision_png_bytes(&valid).is_ok());
        let mut crc_corrupt=valid.clone();
        crc_corrupt[45]^=0x10;
        assert!(verify_vision_png_bytes(&crc_corrupt).is_err());
        let mut junk=valid.clone();
        junk.extend_from_slice(b"secret trailing bytes");
        assert!(verify_vision_png_bytes(&junk).is_err());
        assert!(verify_vision_png_bytes(&valid[..valid.len()-1]).is_err());
        let mut huge=valid.clone();
        huge[16..20].copy_from_slice(&8192_u32.to_be_bytes());
        huge[20..24].copy_from_slice(&8192_u32.to_be_bytes());
        assert!(verify_vision_png_bytes(&huge).is_err());
    }
    #[test]
    fn desktop_png_verification_rejects_corruption_and_accepts_bounded_container() {
        let path=std::env::temp_dir().join(format!(
            "shuvi39-desktop-png-fixture-{}-{}.png",
            std::process::id(), uuid::Uuid::new_v4()));
        let valid=sample_png();
        std::fs::write(&path,&valid).unwrap();
        assert!(verify_unbound_desktop_png(&path).is_ok());
        let mut corrupt=valid.clone();
        corrupt[45] ^= 0x20;
        std::fs::write(&path,&corrupt).unwrap();
        assert!(verify_unbound_desktop_png(&path).is_err());
        std::fs::remove_file(&path).unwrap();
        assert!(verify_unbound_desktop_png(&path).is_err());
    }
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
        json!({"Title":"Adobe Premiere Pro","ProcessId":451,"ProcessStartTicks":638962980000000000_i64,
            "NativeWindowHandle":8122,
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
    fn rejects_large_png_dimensions_to_bound_raw_bitmap_memory() {
        let mut big = receipt();
        big["Width"] = serde_json::json!(7680);
        big["Height"] = serde_json::json!(4801);
        // Just above the 36,864,000-pixel ceiling must fail closed.
        assert!(verify_capture_receipt(&big, &png_header(7680, 4801), 500_000).is_err());
        let mut within = receipt();
        within["Width"] = serde_json::json!(7680);
        within["Height"] = serde_json::json!(4320);
        assert!(verify_capture_receipt(&within, &png_header(7680, 4320), 500_000).is_ok());
    }
    #[test]
    fn fails_closed_for_invalid_or_missing_window_identity_and_geometry() {
        for patch in [json!({"ProcessId":0}), json!({"ProcessStartTicks":0}),
            json!({"ProcessStartTicks":-1}), json!({"ProcessStartTicks":null}),
            json!({"NativeWindowHandle":0}),
            json!({"Width":123}), json!({"Title":""}), json!({"Left":null})] {
            let mut broken = receipt();
            for (key, value) in patch.as_object().unwrap() { broken[key] = value.clone(); }
            assert!(verify_capture_receipt(&broken, &png_header(1920, 1080), 300000).is_err());
        }
    }
}
