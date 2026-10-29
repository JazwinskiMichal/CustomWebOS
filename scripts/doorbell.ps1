<#
.SYNOPSIS
  Ring the doorbell box on the TV, or send it its settings.

.DESCRIPTION
  -Ring       Launches org.jazwinski.customwebos.doorbell over SSH, which is
              what a real ring does (Home Assistant later does the same
              through the TV's own remote-control API).
  -Configure  Checks .local/doorbell.json and writes it to the TV as
              /var/lib/customwebos/doorbell.json, where the home service
              reads it. Shape:
                {"cameraUrl": "http://<camera>/mjpeg",
                 "cameraMode": "mjpeg" | "snapshot",
                 "doorUrl": "http://<home-assistant>/api/webhook/<id>"}
              doorUrl is optional; without it OK-OK only shows
              "Door opened (test)".

.PARAMETER TvHost
  TV's LAN IP or hostname.

.PARAMETER ConfigPath
  Settings file for -Configure. Defaults to .local/doorbell.json.

.PARAMETER Port
  SSH port. Defaults to 22022 (see docs/setup.md §3.3).

.PARAMETER KeyPath
  Private key for root. Defaults to ~/.ssh/id_ed25519_lgtv.

.PARAMETER WhatIf
  Dry-run. Prints the command and exits 0.

.EXAMPLE
  powershell -NoProfile -File scripts/doorbell.ps1 -TvHost 192.168.1.50 -Configure
  powershell -NoProfile -File scripts/doorbell.ps1 -TvHost 192.168.1.50 -Ring
#>
[CmdletBinding(SupportsShouldProcess, DefaultParameterSetName='Ring')]
param(
    [Parameter(Mandatory=$true)][string]$TvHost,
    [Parameter(Mandatory=$true, ParameterSetName='Ring')][switch]$Ring,
    [Parameter(Mandatory=$true, ParameterSetName='Configure')][switch]$Configure,
    [Parameter(ParameterSetName='Configure')][string]$ConfigPath,
    [int]$Port = 22022,
    [string]$KeyPath = (Join-Path $env:USERPROFILE '.ssh\id_ed25519_lgtv')
)

$ErrorActionPreference = 'Stop'

if (-not $ConfigPath) { $ConfigPath = Join-Path (Split-Path -Parent $PSScriptRoot) '.local/doorbell.json' }
$appId = 'org.jazwinski.customwebos.doorbell'
$file  = '/var/lib/customwebos/doorbell.json'

if ($Ring) {
    # The JSON goes on stdin to sh, not in ssh's arguments: Windows PowerShell
    # strips double quotes from native arguments (see install.ps1).
    $stdin  = "luna-send -n 1 luna://com.webos.applicationManager/launch '{`"id`":`"$appId`"}' < /dev/null"
    $remote = "tr -d '\015' | sh -s"
    $action = 'ring the doorbell box'
} else {
    if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "settings not found at: $ConfigPath" }
    try { $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json -ErrorAction Stop }
    catch { throw "$ConfigPath is not valid JSON: $($_.Exception.Message)" }
    if (-not $config.cameraUrl) { throw "$ConfigPath needs a cameraUrl" }
    if ($config.cameraMode -notin @('mjpeg', 'snapshot')) { throw "$ConfigPath needs cameraMode 'mjpeg' or 'snapshot'" }
    $remote = "mkdir -p /var/lib/customwebos && tr -d '\015' > $file && chmod 600 $file"
    $action = "write $file"
}

$sshArgs = @('-p', "$Port", '-i', $KeyPath, "root@$TvHost", $remote)
$cmd = "ssh -p $Port -i `"$KeyPath`" root@$TvHost `"$remote`""
if ($Configure) { $cmd += " < `"$ConfigPath`"" } else { $cmd += " <<< $stdin" }

if (-not $PSCmdlet.ShouldProcess("root@$TvHost", $action)) {
    Write-Output "would run: $cmd"
    exit 0
}
if (-not (Test-Path -LiteralPath $KeyPath)) { throw "SSH key not found at: $KeyPath" }

Write-Output "running: $cmd"
# Same BOM care as inputhook-patch.ps1; CRs are stripped on the TV.
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
try { [Console]::InputEncoding = $OutputEncoding } catch { }
if ($Ring) {
    $stdin | & ssh @sshArgs
} else {
    (Get-Content -LiteralPath $ConfigPath -Raw) | & ssh @sshArgs
}
if ($LASTEXITCODE -ne 0) { throw "ssh exited with code $LASTEXITCODE" }
