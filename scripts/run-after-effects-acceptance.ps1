# Opt-in test entry point. Default operation only discovers existing runtimes.
[CmdletBinding()]
param(
    [switch]$Run,
    [string]$AfterFXPath,
    [ValidateSet('core','render','cancel')][string]$Phase = 'core',
    [string]$OutputModuleTemplate,
    [ValidateSet('mov','mp4','avi')][string]$OutputExtension = 'mov',
    [string]$EvidenceRoot = $env:TEMP
)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$adobeRoot = Join-Path $env:ProgramFiles 'Adobe'
function Assert-RegularInstall([string]$Path) {
    $resolved = [IO.Path]::GetFullPath($Path)
    $trustedPrefix = [IO.Path]::GetFullPath($adobeRoot).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($trustedPrefix, [StringComparison]::OrdinalIgnoreCase) -or
        $resolved.Substring($trustedPrefix.Length) -notmatch '^Adobe After Effects[^\\]*\\Support Files\\AfterFX\.exe$') {
        throw 'AfterFX must be an existing supported Program Files/Adobe installation.'
    }
    $item = Get-Item -LiteralPath $resolved -Force
    if ($item.PSIsContainer) { throw 'AfterFX is not a regular executable file.' }
    $part = $item
    while ($null -ne $part) {
        if (($part.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'AfterFX path contains a reparse point.' }
        $part = if ($part -is [IO.FileInfo]) { $part.Directory } else { $part.Parent }
    }
    return $resolved
}
$candidates = @()
if (Test-Path -LiteralPath $adobeRoot -PathType Container) {
    foreach ($directory in (Get-ChildItem -LiteralPath $adobeRoot -Directory | Select-Object -First 128)) {
        if ($directory.Name.StartsWith('Adobe After Effects')) {
            $candidate = Join-Path $directory.FullName 'Support Files\AfterFX.exe'
            if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                try { $candidates += Assert-RegularInstall $candidate } catch { Write-Verbose $_.Exception.Message }
            }
        }
    }
}
if ($AfterFXPath) { $selected = Assert-RegularInstall $AfterFXPath }
elseif ($candidates.Count -eq 1) { $selected = $candidates[0] }
else { $selected = $null }
$cargoCommand = Get-Command cargo -CommandType Application -ErrorAction SilentlyContinue
$probePath = Join-Path $env:ProgramFiles 'ffmpeg\bin\ffprobe.exe'
$head = & git -C $repoRoot rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Could not bind acceptance to source HEAD.' }
$availability = [ordered]@{
    schema_version=1; source_sha=$head.Trim(); observed_at_utc=[DateTime]::UtcNow.ToString('o')
    state=$(if ($null -eq $selected -and $candidates.Count -eq 0) { 'runtime_unavailable' }
        elseif ($null -eq $selected) { 'runtime_selection_required' }
        elseif ($null -eq $cargoCommand) { 'rust_toolchain_unavailable' } else { 'available_not_executed' })
    after_effects_candidates=$candidates; selected_afterfx=$selected
    rust_toolchain_available=($null -ne $cargoCommand)
    media_probe_candidate_present=(Test-Path -LiteralPath $probePath -PathType Leaf)
    real_host_tests_completed=0; runtime_verified=$false; production_ready=$false
}
$availability | ConvertTo-Json -Depth 6
if (-not $Run) { return }
if ($Phase -in @('render','cancel') -and (-not $OutputModuleTemplate -or $OutputModuleTemplate.Length -gt 240)) {
    throw 'Render phases require an exact inspected output module template; no template names are guessed.'
}
if ($null -eq $selected) { throw 'Real AE runtime unavailable or ambiguous; no software was installed and no fixture was created.' }
if ($null -eq $cargoCommand) { throw 'Rust toolchain unavailable; no software was installed and no fixture was created.' }
if (Get-Process AfterFX -ErrorAction SilentlyContinue) { throw 'An AfterFX process is already running. Preserve/close user work before explicitly starting a disposable acceptance session.' }
if (-not [IO.Path]::IsPathRooted($EvidenceRoot) -or -not (Test-Path -LiteralPath $EvidenceRoot -PathType Container)) {
    throw 'EvidenceRoot must be an existing absolute directory.'
}
$dirty = & git -C $repoRoot status --porcelain
if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Acceptance requires a clean source checkout.' }
$previousOptIn = [Environment]::GetEnvironmentVariable('SHUVI_AE_ACCEPTANCE','Process')
$previousExe = [Environment]::GetEnvironmentVariable('SHUVI_AE_EXE','Process')
$previousRoot = [Environment]::GetEnvironmentVariable('SHUVI_AE_EVIDENCE_ROOT','Process')
$previousPhase = [Environment]::GetEnvironmentVariable('SHUVI_AE_PHASE','Process')
$previousTemplate = [Environment]::GetEnvironmentVariable('SHUVI_AE_OUTPUT_TEMPLATE','Process')
$previousExtension = [Environment]::GetEnvironmentVariable('SHUVI_AE_OUTPUT_EXTENSION','Process')
try {
    $env:SHUVI_AE_ACCEPTANCE = 'disposable-only'
    $env:SHUVI_AE_EXE = $selected
    $env:SHUVI_AE_EVIDENCE_ROOT = [IO.Path]::GetFullPath($EvidenceRoot)
    $env:SHUVI_AE_PHASE = $Phase
    $env:SHUVI_AE_OUTPUT_TEMPLATE = $OutputModuleTemplate
    $env:SHUVI_AE_OUTPUT_EXTENSION = $OutputExtension
    & $cargoCommand.Source test --manifest-path (Join-Path $repoRoot 'src-tauri\Cargo.toml') --lib after_effects_acceptance::tests::real_host_acceptance -- --ignored --exact --nocapture --test-threads=1
    if ($LASTEXITCODE -ne 0) { throw 'Acceptance stopped or failed. Review retained request/receipt evidence; do not retry uncertain mutations.' }
} finally {
    [Environment]::SetEnvironmentVariable('SHUVI_AE_ACCEPTANCE',$previousOptIn,'Process')
    [Environment]::SetEnvironmentVariable('SHUVI_AE_EXE',$previousExe,'Process')
    [Environment]::SetEnvironmentVariable('SHUVI_AE_EVIDENCE_ROOT',$previousRoot,'Process')
    [Environment]::SetEnvironmentVariable('SHUVI_AE_PHASE',$previousPhase,'Process')
    [Environment]::SetEnvironmentVariable('SHUVI_AE_OUTPUT_TEMPLATE',$previousTemplate,'Process')
    [Environment]::SetEnvironmentVariable('SHUVI_AE_OUTPUT_EXTENSION',$previousExtension,'Process')
}
