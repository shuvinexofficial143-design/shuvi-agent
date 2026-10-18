# M60 — Verify the ACTUAL NSIS packaged payload, not a synthetic fixture.
# Read-only EXTRACT to an isolated temporary directory; NEVER execute the
# installer or desktop main app. M61 runs ONLY the verified fixed SHA worker
# on temporary fixtures using the approved immutable read-only protocol.
# This is UNSIGNED build-package acceptance only, not Windows installation.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$ManifestPath,
  [Parameter(Mandatory=$true)][string]$NsiBundleDirectory,
  [Parameter(Mandatory=$true)][string]$SidecarPath
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

# Use the built-in .NET streaming SHA256 rather than relying on an
# auto-imported hashing cmdlet absent on some CI images.
# The read-only handle denies concurrent file writes/deletes while hashing.
function Get-ShuviFileSha256 {
  param([Parameter(Mandatory=$true)][string]$LiteralPath)
  if (-not [IO.Path]::IsPathRooted($LiteralPath)) {
    throw 'SHA input must be an absolute source file.'
  }
  $stream=[IO.File]::Open($LiteralPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  try {
    $digest=[Security.Cryptography.SHA256]::Create()
    try {
      return [BitConverter]::ToString($digest.ComputeHash($stream)).Replace('-','').ToLowerInvariant()
    }
    finally { $digest.Dispose() }
  }
  finally { $stream.Dispose() }
}
$root=[IO.Path]::GetFullPath($NsiBundleDirectory)
$manifestFile=[IO.Path]::GetFullPath($ManifestPath)
$sidecarFile=[IO.Path]::GetFullPath($SidecarPath)
$manifest=Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
$keys=@($manifest.PSObject.Properties.Name | Sort-Object)
$expected=@('schemaVersion','target','installerFilename','installerBytes','installerSha256',
  'workerFilename','workerBytes','workerSha256','signingVerified',
  'installedWindowsVerified','applicationVerified' | Sort-Object)
if (@(Compare-Object $keys $expected).Count -ne 0 -or
  $manifest.schemaVersion -ne 1 -or
  $manifest.signingVerified -ne $false -or
  $manifest.installedWindowsVerified -ne $false -or
  $manifest.applicationVerified -ne $false) {
  throw 'Release witness has extra keys or claims unperformed signing/installation.'
}
if ($manifest.target -notmatch '^(?:x86_64|aarch64|i686)-pc-windows-msvc$' -or
    $manifest.workerFilename -cne ('shuvi-readonly-hash-worker-'+$manifest.target+'.exe') -or
    $manifest.installerFilename -cnotmatch '^Shuvi_[0-9A-Za-z._-]+-setup\.exe$' -or
    $manifest.workerSha256 -cnotmatch '^[0-9a-f]{64}$' -or
    $manifest.installerSha256 -cnotmatch '^[0-9a-f]{64}$') {
  throw 'Release witness target or exact filename/SHA identity is invalid.'
}
foreach ($d in @($root,[IO.Path]::GetDirectoryName($sidecarFile))) {
  $item=Get-Item -LiteralPath $d -ErrorAction Stop
  if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'NSIS/source directory redirected.'
  }
}
$installers=@(Get-ChildItem -LiteralPath $root -File -Filter '*.exe' -ErrorAction Stop)
if ($installers.Count -ne 1 -or $installers[0].Name -cne $manifest.installerFilename){
  throw 'Require exactly one actual NSIS installer; stale/foreign installer forbidden.'
}
$installer=$installers[0].FullName
$worker=Get-Item -LiteralPath $sidecarFile -ErrorAction Stop
foreach($p in @($installer,$worker.FullName)){
  $item=Get-Item -LiteralPath $p -ErrorAction Stop
  if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){
    throw 'Release input file redirected.'
  }
}
if($worker.Name -cne $manifest.workerFilename -or
   $installers[0].Length -ne $manifest.installerBytes -or
   $worker.Length -ne $manifest.workerBytes -or
   (Get-ShuviFileSha256 -LiteralPath $installer) -cne $manifest.installerSha256 -or
   (Get-ShuviFileSha256 -LiteralPath $worker.FullName) -cne $manifest.workerSha256){
   throw 'Actual NSIS or staged worker differs from M59 immutable content witness.'
}
$seven=Get-Command '7z.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $seven) { $seven=Get-Command '7z' -ErrorAction SilentlyContinue | Select-Object -First 1 }
$sevenPath=if($seven){$seven.Source}else{Join-Path $env:ProgramFiles '7-Zip\7z.exe'}
if (-not (Test-Path -LiteralPath $sevenPath -PathType Leaf)){
  throw '7-Zip executable unavailable. Cannot inspect actual compressed NSIS payload.'
}
$extract=Join-Path ([IO.Path]::GetTempPath()) ('shuvi-m60-nsis-'+[guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $extract -ErrorAction Stop)
try{
  # 7-Zip extracts the NSIS compressed payload; NO NSIS installer execution.
  & $sevenPath x -y "-o$extract" "$installer" | Out-Null
  if ($LASTEXITCODE -ne 0){throw 'NSIS payload extraction failed.'}
  $all=@(Get-ChildItem -LiteralPath $extract -File -Recurse -Force -ErrorAction Stop)
  if($all.Count -gt 8000){throw 'NSIS extracted too many entries; deny unbounded package.'}
  $workers=@($all | Where-Object {$_.Name -ieq 'shuvi-readonly-hash-worker.exe'})
  $main=@($all | Where-Object {$_.Name -ieq 'shuvi.exe'})
  if($workers.Count -ne 1 -or $main.Count -ne 1){
    throw 'Real NSIS payload must contain exactly one fixed SHA worker and one Shuvi desktop EXE.'
  }
  foreach($file in @($workers[0],$main[0])){
    if(($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
       $file.Length -lt 1024 -or $file.Length -gt 536870912){
      throw 'Actual NSIS main/worker file unsafe or redirected.'
    }
  }
  if($workers[0].Length -ne $manifest.workerBytes -or
     (Get-ShuviFileSha256 -LiteralPath $workers[0].FullName) -cne $manifest.workerSha256){
    throw 'Actual COMPRESSED NSIS payload SHA worker bytes do not match compiled main app pin.'
  }
  # M61: the only executable run during package test is the fixed,
  # SHA-matched, compiled read-only worker from the ACTUAL NSIS payload.
  # The installer and desktop app are NEVER started or silently installed.
  $workerDir=$workers[0].Directory.FullName
  if ($main[0].Directory.FullName -cne $workerDir) {
    throw 'Packed Shuvi.exe and immutable SHA worker must share one installed app directory.'
  }
  $node=Get-Command 'node.exe' -ErrorAction Stop | Select-Object -First 1
  $smokeScript=Join-Path $PSScriptRoot 'check-installed-shuvi-worker.mjs'
  if(-not (Test-Path -LiteralPath $smokeScript -PathType Leaf)){
    throw 'Exact installed SHA worker verifier script unavailable.'
  }
  $smokeStdout= & $node.Source $smokeScript --manifest $manifestFile --install-dir $workerDir | Out-String
  if($LASTEXITCODE -ne 0){
    throw 'EXTRACTED real compressed SHA worker execution or negative-case check failed.'
  }
  $smoke=$smokeStdout | ConvertFrom-Json
  if($smoke.schemaVersion -ne 1 -or
     $smoke.installedWorkerSha256 -cne $manifest.workerSha256 -or
     $smoke.exactReadOnlyShaProtocolVerified -ne $true -or
     $smoke.shaMismatchRejected -ne $true -or
     $smoke.uuidEvidenceReplayRejected -ne $true -or
     $smoke.unknownCommandRejected -ne $true -or
     $smoke.codeSigningVerified -ne $false -or
     $smoke.mainApplicationVerified -ne $false -or
     $smoke.ownerDesktopEndToEndVerified -ne $false -or
     $smoke.autoRetryAuthorized -ne $false) {
    throw 'Extracted Windows worker smoke evidence incomplete or falsely claims application acceptance.'
  }
  [pscustomobject]@{
    schemaVersion=1
    actualNsisPayloadExtracted=$true
    exactPackedWorkerSha256Matched=$true
    realPackedReadOnlyWorkerExecuted=$true
    badDigestAndReplayRejected=$true
    singlePackedDesktopExeFound=$true
    packedMainExeBytes=[long]$main[0].Length
    packedMainExeSha256=(Get-ShuviFileSha256 -LiteralPath $main[0].FullName)
    packedWorkerSha256=$manifest.workerSha256
    installerSha256=$manifest.installerSha256
    signingVerified=$false
    installedWindowsVerified=$false
    mainApplicationVerified=$false
    ownerDesktopEndToEndVerified=$false
    autoRetryAuthorized=$false
  } | ConvertTo-Json -Depth 2
}
finally{
  Remove-Item -LiteralPath $extract -Force -Recurse -ErrorAction SilentlyContinue
}
