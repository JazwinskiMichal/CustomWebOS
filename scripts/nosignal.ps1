<#
.SYNOPSIS
  Install (or remove) the CustomWebOS no-signal slideshow watcher on the TV.

.DESCRIPTION
  Streams scripts/nosignal.sh to the TV over SSH and writes it as
  /var/lib/webosbrew/init.d/customwebos-nosignal (mode 755). Homebrew
  Channel runs that directory once per boot; from then on, an HDMI input
  that loses its picture is covered with the USB stick's photos
  (docs/superpowers/specs/2026-10-27-no-signal-slideshow-design.md).

  The script is piped over stdin; CRs are stripped on the TV, since sh
  there chokes on them and PowerShell appends CRLF to piped input.

.PARAMETER TvHost
  TV's LAN IP or hostname.

.PARAMETER Remove
  Delete the hook and stop the running watcher (its pids are in
  /tmp/nosignal/pids on the TV).

.PARAMETER Port
  SSH port. Defaults to 22022 (see docs/setup.md §3.3).

.PARAMETER KeyPath
  Private key for root. Defaults to ~/.ssh/id_ed25519_lgtv.

.PARAMETER WhatIf
  Dry-run. Prints the command and exits 0.

.EXAMPLE
  powershell -NoProfile -File scripts/nosignal.ps1 -TvHost 192.168.1.50 -WhatIf
  powershell -NoProfile -File scripts/nosignal.ps1 -TvHost 192.168.1.50 -Remove
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory=$true)][string]$TvHost,
    [switch]$Remove,
    [int]$Port = 22022,
    [string]$KeyPath = (Join-Path $env:USERPROFILE '.ssh\id_ed25519_lgtv')
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$shScript  = Join-Path $scriptDir 'nosignal.sh'
$target    = '/var/lib/webosbrew/init.d/customwebos-nosignal'

# No double quotes in $remote: Windows PowerShell strips them from native
# command arguments.
if ($Remove) {
    $remote = "kill `$(cat /tmp/nosignal/pids 2>/dev/null) 2>/dev/null; rm -f $target; ls /var/lib/webosbrew/init.d"
    $action = 'remove the no-signal watcher'
} else {
    if (-not (Test-Path -LiteralPath $shScript)) { throw "nosignal.sh not found at: $shScript" }
    $remote = "mkdir -p /var/lib/webosbrew/init.d && tr -d '\015' > $target && chmod 755 $target && ls -la $target"
    $action = 'install the no-signal watcher'
}
$sshArgs = @('-p', "$Port", '-i', $KeyPath, "root@$TvHost", $remote)
$cmd     = "ssh -p $Port -i `"$KeyPath`" root@$TvHost `"$remote`""
if (-not $Remove) { $cmd += " < `"$shScript`"" }

if (-not $PSCmdlet.ShouldProcess("root@$TvHost", $action)) {
    Write-Output "would run: $cmd"
    exit 0
}

if (-not (Test-Path -LiteralPath $KeyPath)) {
    throw "SSH key not found at: $KeyPath"
}

Write-Output "running: $cmd"
if ($Remove) {
    & ssh @sshArgs
} else {
    $OutputEncoding = New-Object System.Text.UTF8Encoding $false
    # On a UTF-8 console (code page 65001) Windows PowerShell still writes a BOM
    # unless the console input encoding is BOM-less too; sh on the TV then
    # fails the first line.
    try { [Console]::InputEncoding = $OutputEncoding } catch { }
    ((Get-Content -LiteralPath $shScript -Raw) -replace "`r`n", "`n") | & ssh @sshArgs
}
if ($LASTEXITCODE -ne 0) {
    throw "ssh exited with code $LASTEXITCODE"
}
if ($Remove) {
    Write-Output "Removed. From the next boot no slideshow covers a dark HDMI input."
} else {
    Write-Output "Installed. It runs at the next boot (power-on, or reboot)."
}
