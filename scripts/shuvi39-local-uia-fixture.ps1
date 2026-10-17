# Owner-only disposable UIA fixture. CI parses, never opens this window.
[CmdletBinding()]
param([switch]$IApproveDisposableFixture)
$ErrorActionPreference = 'Stop'
if (-not $IApproveDisposableFixture) {
 throw "No window launched. Pass -IApproveDisposableFixture explicitly."
}
if ($env:OS -ne 'Windows_NT') { throw 'Requires Windows desktop.' }
if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
 throw 'Run powershell.exe -STA. No window launched.'
}
Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
Add-Type -AssemblyName System.Drawing -ErrorAction Stop
[System.Windows.Forms.Application]::EnableVisualStyles()
$script:shuvi39State=[pscustomobject]@{Clicks=0; Submitted=''; Toggle=$false}
$form=[System.Windows.Forms.Form]::new()
$form.Text='Shuvi39 Safe UIA Fixture'
$form.Name='Shuvi39TestWindow'
$form.Width=620
$form.Height=340
$form.StartPosition=[System.Windows.Forms.FormStartPosition]::CenterScreen
$form.MaximizeBox=$false
$heading=[System.Windows.Forms.Label]::new()
$heading.Text='SHUVI 39 - DISPOSABLE UI AUTOMATION TEST'
$heading.Name='Shuvi39Heading'
$heading.SetBounds(20,20,560,25)
$input=[System.Windows.Forms.TextBox]::new()
$input.Name='Shuvi39TestInput'
$input.AccessibleName='Shuvi39 Test Input'
$input.Text='unchanged'
$input.SetBounds(20,60,400,28)
$button=[System.Windows.Forms.Button]::new()
$button.Name='Shuvi39ApplyButton'
$button.AccessibleName='Apply Test Change'
$button.Text='Apply Test Change'
$button.SetBounds(20,108,190,32)
$toggle=[System.Windows.Forms.CheckBox]::new()
$toggle.Name='Shuvi39TestToggle'
$toggle.AccessibleName='Shuvi39 Test Toggle'
$toggle.Text='Enable disposable fixture'
$toggle.SetBounds(245,108,280,30)
$status=[System.Windows.Forms.Label]::new()
$status.Name='Shuvi39Status'
$status.AccessibleName='Shuvi39 Readback Status'
$status.Text='Status: idle'
$status.SetBounds(20,160,560,35)
$description=[System.Windows.Forms.Label]::new()
$description.Name='Shuvi39Instructions'
$description.Text='Approve each Shuvi UI action separately. Close window to end.'
$description.SetBounds(20,210,560,35)
$button.Add_Click({
 $script:shuvi39State.Clicks += 1
 $script:shuvi39State.Submitted=$input.Text
 $status.Text="Status: applied $($script:shuvi39State.Clicks) - $($input.Text)"
})
$toggle.Add_CheckedChanged({
 $script:shuvi39State.Toggle=[bool]$toggle.Checked
})
$form.Controls.AddRange([System.Windows.Forms.Control[]]@(
 $heading,$input,$button,$toggle,$status,$description
))
Write-Output "Ready: Shuvi39 Safe UIA Fixture"
Write-Output "Use Shuvi ui_windows, ui_discover, ui_find, ui_click, ui_set_value, ui_toggle."
Write-Output "Every mutation still requires separate approval within Shuvi."
try {
 [void]$form.ShowDialog()
 [pscustomobject]@{
  schema='shuvi39.disposable_uia_fixture.v1'
  clicks=$script:shuvi39State.Clicks
  submitted=$script:shuvi39State.Submitted
  toggle=$script:shuvi39State.Toggle
  premiere_or_blender_verified=$false
 } | ConvertTo-Json -Compress
}
finally { $form.Dispose() }
