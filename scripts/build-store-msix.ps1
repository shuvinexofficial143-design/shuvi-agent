# Prepare a Shuvi Windows MSIX for submission to Microsoft Store only.
# UNSIGNED output is NOT safe for sideloading; Microsoft Store must certify/sign.
[CmdletBinding()]
param(
 [Parameter(Mandatory)][string]$IdentityName,
 [Parameter(Mandatory)][string]$Publisher,
 [Parameter(Mandatory)][string]$PublisherDisplayName,
 [string]$OutputDirectory="dist-store"
)
Set-StrictMode -Version Latest
$ErrorActionPreference="Stop"
if ($IdentityName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{2,99}$') { throw "Use the exact reserved Partner Center Identity Name." }
if ($Publisher -notmatch '^CN=.{1,250}$' -or $Publisher -match '[\x00-\x1f]') { throw "Use the exact Partner Center CN=... Publisher identity." }
if (!$PublisherDisplayName.Trim() -or $PublisherDisplayName.Length -gt 128) { throw "Invalid publisher display name." }
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$config=Get-Content (Join-Path $repo "src-tauri/tauri.conf.json") -Raw | ConvertFrom-Json
$ver="$($config.version)".Split(".")
if ($ver.Count -ne 3 -or @($ver | Where-Object { $_ -notmatch '^\d{1,5}$' }).Count -ne 0) { throw "Expected Tauri semantic version like 0.1.1." }
$version=($ver+@("0")) -join "."
$exe=Join-Path $repo "src-tauri/target/release/shuvi.exe"
if (!(Test-Path $exe -PathType Leaf)) { throw "First compile native shuvi.exe." }
$stage=Join-Path ([IO.Path]::GetTempPath()) "shuvi-store-stage"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
Copy-Item $exe (Join-Path $stage "shuvi.exe")
# Tauri resource destinations: do not drop Blender/Adobe bridge files.
$resources=@{
 "integrations/after-effects-extendscript/shuvi-ae.jsx"="after-effects/shuvi-ae.jsx"
 "integrations/blender-worker/shuvi_blender_bridge.py"="blender-worker/shuvi_blender_bridge.py"
 "integrations/blender-worker/shuvi_blender_plan.py"="blender-worker/shuvi_blender_plan.py"
}
foreach ($key in $resources.Keys) {
 $source=Join-Path $repo $key
 if (!(Test-Path $source -PathType Leaf)) { throw "Missing Shuvi native resource: $key" }
 $dest=Join-Path $stage $resources[$key]
 New-Item -ItemType Directory ([IO.Path]::GetDirectoryName($dest)) -Force | Out-Null
 Copy-Item $source $dest
}
# Generate three correctly sized Windows logo PNGs (no downloaded assets).
Add-Type -AssemblyName System.Drawing
$assets=Join-Path $stage "Assets"
New-Item -ItemType Directory $assets -Force | Out-Null
foreach ($entry in @(@(44,"Square44x44Logo.png"),@(150,"Square150x150Logo.png"),@(50,"StoreLogo.png"))) {
 $size=[int]$entry[0]
 $bmp=[System.Drawing.Bitmap]::new($size,$size)
 $g=[System.Drawing.Graphics]::FromImage($bmp)
 $bg=[System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(11,18,32))
 $fg=[System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
 $font=[System.Drawing.Font]::new("Segoe UI",[float]($size*0.5),[System.Drawing.FontStyle]::Bold,[System.Drawing.GraphicsUnit]::Pixel)
 $fmt=[System.Drawing.StringFormat]::new()
 try {
  $fmt.Alignment=[System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment=[System.Drawing.StringAlignment]::Center
  $g.FillRectangle($bg,0,0,$size,$size)
  $g.DrawString("S",$font,$fg,[System.Drawing.RectangleF]::new(0,0,$size,$size),$fmt)
  $bmp.Save((Join-Path $assets $entry[1]),[System.Drawing.Imaging.ImageFormat]::Png)
 } finally {
  $fmt.Dispose();$font.Dispose();$fg.Dispose();$bg.Dispose();$g.Dispose();$bmp.Dispose()
 }
}
$n=[System.Security.SecurityElement]::Escape($IdentityName)
$p=[System.Security.SecurityElement]::Escape($Publisher)
$d=[System.Security.SecurityElement]::Escape($PublisherDisplayName)
$manifest=@"
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
 xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
 xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10"
 xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
 IgnorableNamespaces="uap uap10 rescap">
 <Identity Name="$n" Publisher="$p" Version="$version" ProcessorArchitecture="x64"/>
 <Properties>
  <DisplayName>Shuvi</DisplayName>
  <PublisherDisplayName>$d</PublisherDisplayName>
  <Description>Shuvi permission-first Windows computer agent</Description>
  <Logo>Assets\StoreLogo.png</Logo>
 </Properties>
 <Resources><Resource Language="en-US"/></Resources>
 <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0"/></Dependencies>
 <Applications>
  <Application Id="Shuvi" Executable="shuvi.exe" uap10:RuntimeBehavior="packagedClassicApp" uap10:TrustLevel="mediumIL">
   <uap:VisualElements DisplayName="Shuvi" Description="Shuvi computer agent" BackgroundColor="#0B1220"
    Square150x150Logo="Assets\Square150x150Logo.png" Square44x44Logo="Assets\Square44x44Logo.png"/>
  </Application>
 </Applications>
 <Capabilities><rescap:Capability Name="runFullTrust"/></Capabilities>
</Package>
"@
$manifestPath=Join-Path $stage "AppxManifest.xml"
[IO.File]::WriteAllText($manifestPath,$manifest,[Text.UTF8Encoding]::new($false))
[xml]$parsed=Get-Content $manifestPath -Raw
if ($parsed.Package.Identity.Name -ne $IdentityName -or $parsed.Package.Identity.Publisher -ne $Publisher) { throw "MSIX identity mismatch." }
$kits=Join-Path ([Environment]::GetFolderPath("ProgramFilesX86")) "Windows Kits/10/bin"
$makeappx=Get-ChildItem $kits -Filter makeappx.exe -Recurse -ErrorAction SilentlyContinue |
 Where-Object { $_.FullName -match '[\\/]x64[\\/]makeappx.exe$' } |
 Sort-Object FullName -Descending | Select-Object -First 1
if (!$makeappx) { throw "Windows SDK MakeAppx.exe is missing." }
$output=[IO.Path]::GetFullPath((Join-Path $repo $OutputDirectory))
New-Item -ItemType Directory $output -Force | Out-Null
$msix=Join-Path $output "Shuvi_$($version)_x64_STORE_SUBMISSION_ONLY_UNSIGNED.msix"
& $makeappx.FullName pack /d $stage /p $msix /o
if ($LASTEXITCODE -ne 0 -or !(Test-Path $msix)) { throw "MakeAppx failed. Do not distribute the package." }
Get-FileHash $msix -Algorithm SHA256 |
 Select-Object Hash,Path | ConvertTo-Json |
 Out-File (Join-Path $output "msix-sha256.json") -Encoding utf8
Write-Host "SUCCESS: MSIX created for Store SUBMISSION ONLY: $msix"
Write-Host "UNSIGNED: DO NOT INSTALL DIRECTLY. Microsoft must validate and sign it."
