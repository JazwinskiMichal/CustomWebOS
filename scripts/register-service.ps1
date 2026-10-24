<#
.SYNOPSIS
  Register (or unregister) the CustomWebOS home service with the TV's luna hub.

.DESCRIPTION
  Streams scripts/register-service.sh to the TV over SSH and runs it as root:
      ssh -p <Port> -i <KeyPath> root@<TvHost> "sh -s -- [flags]" < register-service.sh
  Run after installing the .ipk. Reboot the TV afterwards so the hub picks
  the service up cleanly.

  The script is piped over stdin rather than scp'd, so there's no dependency
  on an sftp-server being present on the TV.

.PARAMETER TvHost
  TV's LAN IP or hostname.

.PARAMETER Port
  SSH port. Defaults to 22022 (see docs/setup.md §3.3).

.PARAMETER KeyPath
  Private key for root. Defaults to ~/.ssh/id_ed25519_lgtv.

.PARAMETER Unregister
  Remove the service registration instead (rollback).

.PARAMETER SystemWrapper
  Point Exec= at the stock /usr/bin/run-js-service instead of the bundled
  thirdparty_jail=off wrapper. Diagnostic for the fork-server hang in
  docs/m2-tracking.md.

.PARAMETER DryRunOnTv
  Run register-service.sh on the TV with --dry-run: connects, prints what it
  would write, changes nothing.

.PARAMETER WhatIf
  Dry-run. Prints the ssh command that would run and exits 0 without
  connecting.

.EXAMPLE
  powershell -NoProfile -File scripts/register-service.ps1 -TvHost 192.168.1.50 -WhatIf
  powershell -NoProfile -File scripts/register-service.ps1 -TvHost 192.168.1.50
  powershell -NoProfile -File scripts/register-service.ps1 -TvHost 192.168.1.50 -Unregister
#>
param(
    [Parameter(Mandatory=$true)][string]$TvHost,
    [int]$Port = 22022,
    [string]$KeyPath = (Join-Path $env:USERPROFILE '.ssh\id_ed25519_lgtv'),
    [switch]$Unregister,
    [switch]$SystemWrapper,
    [switch]$DryRunOnTv,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$shScript  = Join-Path $scriptDir 'register-service.sh'

if (-not (Test-Path -LiteralPath $shScript)) {
    throw "register-service.sh not found at: $shScript"
}

$flags = @()
if ($DryRunOnTv)    { $flags += '--dry-run' }
if ($Unregister)    { $flags += '--unregister' }
if ($SystemWrapper) { $flags += '--system-wrapper' }

$remote  = ('sh -s -- ' + ($flags -join ' ')).Trim()
$sshArgs = @('-p', "$Port", '-i', $KeyPath, "root@$TvHost", $remote)
$cmd     = "ssh -p $Port -i `"$KeyPath`" root@$TvHost `"$remote`" < `"$shScript`""

if ($WhatIf) {
    Write-Output "would run: $cmd"
    Write-Output "host: $TvHost"
    Write-Output "port: $Port"
    Write-Output "flags: $($flags -join ' ')"
    exit 0
}

if (-not (Test-Path -LiteralPath $KeyPath)) {
    throw "SSH key not found at: $KeyPath"
}

# /bin/sh on the TV chokes on CRLF; normalise whatever the checkout gave us.
# Windows PowerShell pipes to native commands in $OutputEncoding (ASCII by
# default), so force UTF-8 without BOM.
# PowerShell also appends CRLF after piped input; the trailing exit stops sh
# before it reads the stray CR as a command (exit 127).
$body = ((Get-Content -LiteralPath $shScript -Raw) -replace "`r`n", "`n").TrimEnd() + "`nexit `$?`n"
$OutputEncoding = New-Object System.Text.UTF8Encoding $false

Write-Output "running: $cmd"
$body | & ssh @sshArgs
if ($LASTEXITCODE -ne 0) {
    throw "ssh exited with code $LASTEXITCODE"
}
