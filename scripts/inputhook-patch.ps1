<#
.SYNOPSIS
  Limit LG Input Hook's injection to lginput2 on the TV (or undo that).

.DESCRIPTION
  Streams scripts/inputhook-patch.sh to the TV over SSH and runs it as root.
  Without the patch, a TV that starts on an HDMI input can't switch to Live
  TV or any other source afterwards (black screen until a cold start); see
  the script's header and docs/tv-log.md. Takes effect at the next boot.
  Reinstalling or updating LG Input Hook undoes it: run this again.

.PARAMETER TvHost
  TV's LAN IP or hostname.

.PARAMETER Undo
  Put LG Input Hook's original service.js back.

.PARAMETER Port
  SSH port. Defaults to 22022 (see docs/setup.md §3.3).

.PARAMETER KeyPath
  Private key for root. Defaults to ~/.ssh/id_ed25519_lgtv.

.PARAMETER WhatIf
  Dry-run. Prints the command and exits 0.

.EXAMPLE
  powershell -NoProfile -File scripts/inputhook-patch.ps1 -TvHost 192.168.1.50 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory=$true)][string]$TvHost,
    [switch]$Undo,
    [int]$Port = 22022,
    [string]$KeyPath = (Join-Path $env:USERPROFILE '.ssh\id_ed25519_lgtv')
)

$ErrorActionPreference = 'Stop'

$shScript = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'inputhook-patch.sh'
$remote   = if ($Undo) { "tr -d '\015' | sh -s -- --undo" } else { "tr -d '\015' | sh -s" }
$action   = if ($Undo) { 'undo the LG Input Hook patch' } else { 'limit LG Input Hook to lginput2' }
$sshArgs  = @('-p', "$Port", '-i', $KeyPath, "root@$TvHost", $remote)
$cmd      = "ssh -p $Port -i `"$KeyPath`" root@$TvHost `"$remote`" < `"$shScript`""

if (-not $PSCmdlet.ShouldProcess("root@$TvHost", $action)) {
    Write-Output "would run: $cmd"
    exit 0
}
if (-not (Test-Path -LiteralPath $KeyPath)) { throw "SSH key not found at: $KeyPath" }

Write-Output "running: $cmd"
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
# Same BOM and CR care as nosignal.ps1: sh on the TV fails on either (PowerShell
# adds a CRLF to piped input, so CRs are also stripped on the TV).
try { [Console]::InputEncoding = $OutputEncoding } catch { }
((Get-Content -LiteralPath $shScript -Raw) -replace "`r`n", "`n") | & ssh @sshArgs
if ($LASTEXITCODE -ne 0) { throw "ssh exited with code $LASTEXITCODE" }
Write-Output "Done. It takes effect at the next boot (reboot the TV)."
