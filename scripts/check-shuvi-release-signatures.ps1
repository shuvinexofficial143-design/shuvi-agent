# M59 manual production release gate. Run ONLY on an actual Windows
# installation using a trusted publisher certificate thumbprint obtained
# from the owner independently (NEVER taken from installer or manifest).
# This makes no claims about desktop app/Adobe/Blender live acceptance.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ManifestPath,
    [Parameter(Mandatory=$true)][string]$InstallerPath,
    [Parameter(Mandatory=$true)][string]$InstallDir,
    [Parameter(Mandatory=$true)][string]$ExpectedSignerThumbprint
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($PSVersionTable.PSVersion.Major -lt 5) { throw 'Windows PowerShell 5+ required.' }
if ($ExpectedSignerThumbprint -cnotmatch '^[0-9A-Fa-f]{40}$') {
    throw 'Provide a separately verified exact SHA-1 certificate thumbprint (40 hex).'
}
$thumb=$ExpectedSignerThumbprint.ToUpperInvariant()
$manifest=Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$props=@($manifest.PSObject.Properties.Name | Sort-Object)
$expected=@('applicationVerified','installedWindowsVerified','installerBytes','installerFilename','installerSha256','schemaVersion','signingVerified','target','workerBytes','workerFilename','workerSha256' | Sort-Object)
if (@(Compare-Object $props $expected).Count -ne 0 -or
    $manifest.schemaVersion -ne 1 -or $manifest.signingVerified -ne $false -or
    $manifest.installedWindowsVerified -ne $false -or $manifest.applicationVerified -ne $false) {
    throw 'Unsigned witness metadata invalid or improperly claims release acceptance.'
}
if ($manifest.target -notmatch '^(?:x86_64|aarch64|i686)-pc-windows-msvc$' -or
    $manifest.installerFilename -cnotmatch '^Shuvi_[0-9A-Za-z._-]+-setup\.exe$' -or
    $manifest.workerFilename -cne ('shuvi-readonly-hash-worker-'+$manifest.target+'.exe') -or
    $manifest.installerSha256 -cnotmatch '^[0-9a-f]{64}$' -or
    $manifest.workerSha256 -cnotmatch '^[0-9a-f]{64}$') {
    throw 'Witness filename, target or hashes invalid.'
}
$installer=(Resolve-Path -LiteralPath $InstallerPath).ProviderPath
$dir=(Resolve-Path -LiteralPath $InstallDir).ProviderPath
if (-not (Test-Path -LiteralPath $dir -PathType Container) -or
    [IO.Path]::GetFileName($installer) -cne $manifest.installerFilename) {
    throw 'Provided installer path or installed application directory differs from pinned manifest.'
}
$main=Join-Path $dir 'shuvi.exe'
$worker=Join-Path $dir 'shuvi-readonly-hash-worker.exe'
foreach ($file in @($main,$worker,$installer)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        throw ('Missing actual installed or packaged executable: '+$file)
    }
    $item=Get-Item -LiteralPath $file -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw ('Executable is a symlink/reparse point: '+$file)
    }
    $signature=Get-AuthenticodeSignature -LiteralPath $file
    if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) {
        throw ('Unsigned/untrusted executable; production release denied: '+$file)
    }
    if ($signature.SignerCertificate.Thumbprint.ToUpperInvariant() -cne $thumb) {
        throw ('Executable signer differs from independently trusted owner certificate: '+$file)
    }
}
if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() -cne
    $manifest.installerSha256 -or
    (Get-FileHash -LiteralPath $worker -Algorithm SHA256).Hash.ToLowerInvariant() -cne
    $manifest.workerSha256) {
    throw 'Installed fixed worker or NSIS installer bytes differ from the unsigned witness.'
}
if ((Get-Item -LiteralPath $installer).Length -ne $manifest.installerBytes -or
    (Get-Item -LiteralPath $worker).Length -ne $manifest.workerBytes) {
    throw 'Executable byte lengths differ from the release witness.'
}
[pscustomobject]@{
    schemaVersion = 1
    installerContentVerified = $true
    installedWorkerContentVerified = $true
    mainAuthenticodeVerified = $true
    workerAuthenticodeVerified = $true
    installerAuthenticodeVerified = $true
    signerMatchesOwnerPinnedThumbprint = $true
    installedReadOnlyWorkerProtocolTested = $false
    mainApplicationVerified = $false
    ownerDesktopEndToEndVerified = $false
    autoRetryAuthorized = $false
} | ConvertTo-Json -Depth 2
