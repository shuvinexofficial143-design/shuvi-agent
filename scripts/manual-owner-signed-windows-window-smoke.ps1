# M64: MANUAL owner-consented, SIGNATURE-GATED Shuvi MAIN WINDOW acceptance.
# NEVER invoked by GitHub CI or agents. Does not run Adobe/Blender tasks,
# send network requests, or convert visibility into task success.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$ManifestPath,
 [Parameter(Mandatory=$true)][string]$MainWitnessPath,
 [Parameter(Mandatory=$true)][string]$InstallerPath,
 [Parameter(Mandatory=$true)][string]$InstallDir,
 [Parameter(Mandatory=$true)][string]$ExpectedSignerThumbprint,
 [Parameter(Mandatory=$true)][string]$OwnerConsent
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if($env:CI -eq 'true' -or $env:GITHUB_ACTIONS -eq 'true'){
 throw 'M64 owner desktop acceptance MUST NOT execute on disposable CI.'
}
if($OwnerConsent -cne 'I APPROVE SHUVI WINDOW SMOKE'){
 throw 'Explicit typed owner consent is required to launch the installed Shuvi app.'
}
if($ExpectedSignerThumbprint -cnotmatch '^[0-9A-Fa-f]{40}$'){
 throw 'Use a trusted publisher certificate thumbprint independently confirmed by the owner.'
}
$witness=Get-Content -LiteralPath $MainWitnessPath -Raw | ConvertFrom-Json
$names=@($witness.PSObject.Properties.Name | Sort-Object)
$expected=@('schemaVersion','target','installerSha256','packedMainExeSha256',
 'packedMainExeBytes','signingVerified','ownerWindowsVerified','applicationVerified' | Sort-Object)
if(@(Compare-Object $names $expected).Count -ne 0 -or
 $witness.schemaVersion -ne 1 -or
 $witness.target -notmatch '^(?:x86_64|aarch64|i686)-pc-windows-msvc$' -or
 $witness.packedMainExeSha256 -cnotmatch '^[0-9a-f]{64}$' -or
 $witness.installerSha256 -cnotmatch '^[0-9a-f]{64}$' -or
 $witness.packedMainExeBytes -lt 1024 -or
 $witness.packedMainExeBytes -gt 536870912 -or
 $witness.signingVerified -ne $false -or
 $witness.ownerWindowsVerified -ne $false -or
 $witness.applicationVerified -ne $false){
 throw 'M63 main executable witness is missing, forged or has inflated acceptance.'
}
$manifest=Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
if($manifest.target -cne $witness.target -or
 $manifest.installerSha256 -cne $witness.installerSha256){
 throw 'M59 installer witness and independently extracted M63 main executable do not match.'
}
$path=(Resolve-Path -LiteralPath $InstallDir).ProviderPath
$dir=Get-Item -LiteralPath $path
if(-not $dir.PSIsContainer -or
 ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){
 throw 'Installed Shuvi app directory is missing or redirected.'
}
$exe=Join-Path $path 'Shuvi.exe'
$exeItem=Get-Item -LiteralPath $exe -ErrorAction Stop
if($exeItem.Length -ne $witness.packedMainExeBytes -or
 ($exeItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
 (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant() -cne
 $witness.packedMainExeSha256){
 throw 'Installed main desktop executable differs from the M63 exact NSIS payload.'
}
# M59 existing strict certificate gate verifies installer, main AND sidecar,
# all signed with the same independently owner-pinned real publisher cert.
$gateScript=Join-Path $PSScriptRoot 'check-shuvi-release-signatures.ps1'
$gateArgs=@{
 ManifestPath=$ManifestPath
 InstallerPath=$InstallerPath
 InstallDir=$path
 ExpectedSignerThumbprint=$ExpectedSignerThumbprint
}
$gateOutput= & $gateScript @gateArgs | Out-String
$gate=$gateOutput | ConvertFrom-Json
if($gate.mainAuthenticodeVerified -ne $true -or
 $gate.workerAuthenticodeVerified -ne $true -or
 $gate.installerAuthenticodeVerified -ne $true -or
 $gate.signerMatchesOwnerPinnedThumbprint -ne $true -or
 $gate.installedReadOnlyWorkerProtocolTested -ne $false -or
 $gate.mainApplicationVerified -ne $false){
 throw 'M59 signed-publisher owner acceptance denied; main Shuvi window not launched.'
}
# Fixed-path owner-approved desktop launch. Never enumerate/kill foreign PIDs.
# A visible top-level window is ONLY GUI STARTUP proof, NOT AI task success.
$process=Start-Process -FilePath $exe -WorkingDirectory $path -PassThru -ErrorAction Stop
$visible=$false
$deadline=[Diagnostics.Stopwatch]::StartNew()
try{
 while($deadline.Elapsed.TotalSeconds -lt 60){
  $process.Refresh()
  if($process.HasExited){break}
  if($process.MainWindowHandle -ne [IntPtr]::Zero -and
     $process.MainWindowTitle -match 'Shuvi'){
   $visible=$true
   break
  }
  [Threading.Thread]::Sleep(1000)
 }
 if(-not $visible){
  throw 'Installed signed Shuvi EXE did not expose a matching main window in the bounded startup check.'
 }
 # Only this exact process returned by Start-Process may receive CloseMainWindow.
 # Never Stop-Process, TerminateProcess, taskkill, or PID enumeration fallback.
 if(-not $process.CloseMainWindow()){
  throw 'Owner-launched Shuvi main window could not be closed normally.'
 }
 if(-not $process.WaitForExit(15000)){
  throw 'Shuvi did not exit after cooperative window close; owner review required.'
 }
 [pscustomobject]@{
  schemaVersion=1
  scope='manual-signed-owner-windows-window-only'
  exactNsisMainContentVerified=$true
  installerAuthenticodeVerified=$true
  ownerPinnedPublisherCertificateVerified=$true
  ownerConsentedMainWindowShown=$visible
  ownerLaunchedProcessClosedNormally=$true
  shaSidecarProtocolVerified=$false
  independentOwnerTaskApprovalVerified=$false
  actualBackgroundParallelSchedulerVerified=$false
  blenderOrAdobeTaskVerified=$false
  applicationJobOutcomeVerified=$false
  automaticRetryAuthorized=$false
 } | ConvertTo-Json -Depth 3
}
finally{
 $deadline.Stop()
 if($null -ne $process){$process.Dispose()}
}
