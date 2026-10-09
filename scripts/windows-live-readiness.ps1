# Shuvi Windows live readiness: READ-ONLY host discovery only.
# Does NOT launch Shuvi, Adobe, Blender, AI providers or tests.
[CmdletBinding()]
param([string]$ExpectedSha = "")
$ErrorActionPreference = "Stop"
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$isWindows = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT

function IsAvailable([string]$Name) {
    return $null -ne (Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue)
}
function ExistingLeaf([string]$Relative) {
    return Test-Path -LiteralPath (Join-Path $repoRoot $Relative) -PathType Leaf
}
function RunningCount([string]$Name) {
    $found = @(Get-Process -Name $Name -ErrorAction SilentlyContinue)
    return $found.Count
}
$hasGit = IsAvailable "git"
$head = $null
$branch = $null
$clean = $null
if ($hasGit) {
    $h = & git -C $repoRoot rev-parse HEAD 2>$null
    if ($LASTEXITCODE -eq 0 -and $h) { $head = "$h".Trim() }
    $b = & git -C $repoRoot branch --show-current 2>$null
    if ($LASTEXITCODE -eq 0 -and $b) { $branch = "$b".Trim() }
    if ($head) {
        $changes = @(& git -C $repoRoot status --porcelain 2>$null)
        if ($LASTEXITCODE -eq 0) { $clean = $changes.Count -eq 0 }
    }
}
$expectedSupplied = -not [string]::IsNullOrWhiteSpace($ExpectedSha)
$matchesExpected = [bool]($expectedSupplied -and $head -and
    [string]::Equals($head, $ExpectedSha, [StringComparison]::OrdinalIgnoreCase))
$commands = [ordered]@{
    git=$hasGit; node=(IsAvailable "node"); npm=(IsAvailable "npm")
    cargo=(IsAvailable "cargo"); rustc=(IsAvailable "rustc")
}
$source = [ordered]@{
    git_head=$head; branch=$branch; clean_worktree=$clean
    expected_sha_supplied=$expectedSupplied
    expected_sha_matched=$(if ($expectedSupplied) { $matchesExpected } else { $null })
}
$installed = [ordered]@{
    debug_exe=(ExistingLeaf "src-tauri\target\debug\shuvi.exe")
    release_exe=(ExistingLeaf "src-tauri\target\release\shuvi.exe")
    package_json=(ExistingLeaf "package.json")
    tauri_config=(ExistingLeaf "src-tauri\tauri.conf.json")
    cargo_lock=(ExistingLeaf "src-tauri\Cargo.lock")
}
$running = [ordered]@{
    shuvi=(RunningCount "shuvi")
    premiere=(RunningCount "Adobe Premiere Pro")
    after_effects=(RunningCount "AfterFX")
    blender=(RunningCount "blender")
}
$ready = $isWindows -and $head -and ($branch -eq "phase1/safety-reconciliation-oct9") -and
    ($clean -eq $true) -and $commands.node -and $commands.npm -and $commands.cargo -and
    $installed.package_json -and $installed.tauri_config -and $installed.cargo_lock -and
    ((-not $expectedSupplied) -or $matchesExpected)
$report = [ordered]@{
    schema_version=1; observed_at_utc=[DateTime]::UtcNow.ToString("o")
    mode="read_only_probe"; source=$source; windows_host=$isWindows
    toolchain=$commands; local_artifacts=$installed; existing_processes=$running
    ready_for_separately_approved_host_test=[bool]$ready
    live_host_tests_completed=0; native_ai_requests_sent=0
    adobe_projects_modified=0; production_ready=$false
    note="No apps launched; no process terminated; no network request or billable API call performed."
}
$report | ConvertTo-Json -Depth 5
