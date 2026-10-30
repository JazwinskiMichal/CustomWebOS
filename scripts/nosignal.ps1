<#
.SYNOPSIS
  Install (or remove) the CustomWebOS no-signal slideshow watcher on the TV,
  and point it at a NAS share.

.DESCRIPTION
  Streams scripts/nosignal.sh to the TV over SSH and writes it as
  /var/lib/webosbrew/init.d/customwebos-nosignal (mode 755). Homebrew
  Channel runs that directory once per boot; from then on, an HDMI input
  that loses its picture is covered with photos: the NAS share's if one is
  set up and has photos, else the USB stick's
  (docs/superpowers/specs/2026-10-27-no-signal-slideshow-design.md,
  docs/superpowers/specs/2026-10-29-slideshow-nas-design.md).

  The script is piped over stdin; CRs are stripped on the TV, since sh
  there chokes on them and PowerShell appends CRLF to piped input.

.PARAMETER TvHost
  TV's LAN IP or hostname.

.PARAMETER Remove
  Delete the hook and stop the running watcher (its pids are in
  /tmp/nosignal/pids on the TV).

.PARAMETER ConfigureNas
  Write the NAS share from -NasConfigPath to the TV as
  /var/lib/customwebos/nas.fstab (NFS v3, read-only). The settings file has
  "share": "//host/share" or "host:/path". The NAS must export the share
  over NFS v2/v3 to the TV's IP, read-only (the TV's kernel speaks only
  SMB1, which NASes refuse, and no NFS v4).

.PARAMETER RemoveNas
  Unmount the share and delete the NAS settings: back to the stick only.

.PARAMETER NasConfigPath
  Settings file for -ConfigureNas. Defaults to .local/slideshow-nas.json.

.PARAMETER Port
  SSH port. Defaults to 22022 (see docs/setup.md §3.3).

.PARAMETER KeyPath
  Private key for root. Defaults to ~/.ssh/id_ed25519_lgtv.

.PARAMETER WhatIf
  Dry-run. Prints the command and exits 0.

.EXAMPLE
  powershell -NoProfile -File scripts/nosignal.ps1 -TvHost 192.168.1.50 -WhatIf
  powershell -NoProfile -File scripts/nosignal.ps1 -TvHost 192.168.1.50 -Remove
  powershell -NoProfile -File scripts/nosignal.ps1 -TvHost 192.168.1.50 -ConfigureNas
#>
[CmdletBinding(SupportsShouldProcess, DefaultParameterSetName='Install')]
param(
    [Parameter(Mandatory=$true)][string]$TvHost,
    [Parameter(Mandatory=$true, ParameterSetName='Remove')][switch]$Remove,
    [Parameter(Mandatory=$true, ParameterSetName='ConfigureNas')][switch]$ConfigureNas,
    [Parameter(Mandatory=$true, ParameterSetName='RemoveNas')][switch]$RemoveNas,
    [Parameter(ParameterSetName='ConfigureNas')][string]$NasConfigPath,
    [int]$Port = 22022,
    [string]$KeyPath = (Join-Path $env:USERPROFILE '.ssh\id_ed25519_lgtv')
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$shScript  = Join-Path $scriptDir 'nosignal.sh'
$target    = '/var/lib/webosbrew/init.d/customwebos-nosignal'
$nasFstab  = '/var/lib/customwebos/nas.fstab'
$nasMnt    = '/tmp/customwebos-nas'
if (-not $NasConfigPath) { $NasConfigPath = Join-Path (Split-Path -Parent $scriptDir) '.local/slideshow-nas.json' }

# What goes over stdin: the watcher script, or the fstab line.
$stdin = $null
# No double quotes in $remote: Windows PowerShell strips them from native
# command arguments.
if ($Remove) {
    $remote = "kill `$(cat /tmp/nosignal/pids 2>/dev/null) 2>/dev/null; rm -f $target; ls /var/lib/webosbrew/init.d"
    $action = 'remove the no-signal watcher'
} elseif ($RemoveNas) {
    $remote = "umount -l $nasMnt 2>/dev/null; rm -f $nasFstab; echo NAS settings removed"
    $action = 'remove the NAS share settings'
} elseif ($ConfigureNas) {
    if (-not (Test-Path -LiteralPath $NasConfigPath)) { throw "NAS settings not found at: $NasConfigPath" }
    try { $cfg = Get-Content -LiteralPath $NasConfigPath -Raw | ConvertFrom-Json -ErrorAction Stop }
    catch { throw "$NasConfigPath is not valid JSON: $($_.Exception.Message)" }
    $share = [string]$cfg.share
    if ($share -match '^//([^/\s]+)/(\S+)$') { $nfsHost = $Matches[1]; $source = "${nfsHost}:/$($Matches[2])" }
    elseif ($share -match '^([^:/\s]+):(/\S*)$') { $nfsHost = $Matches[1]; $source = $share }
    else { throw "$NasConfigPath needs a share: //host/share or host:/path" }
    $stdin  = "$source $nasMnt nfs ro,vers=3,nolock,soft,timeo=30,retrans=2,addr=$nfsHost 0 0"
    $remote = "mkdir -p /var/lib/customwebos && tr -d '\015' > $nasFstab.tmp && chmod 600 $nasFstab.tmp && mv $nasFstab.tmp $nasFstab && echo NAS settings written"
    $action = "write $nasFstab"
} else {
    if (-not (Test-Path -LiteralPath $shScript)) { throw "nosignal.sh not found at: $shScript" }
    $stdin  = (Get-Content -LiteralPath $shScript -Raw) -replace "`r`n", "`n"
    $remote = "mkdir -p /var/lib/webosbrew/init.d && tr -d '\015' > $target && chmod 755 $target && ls -la $target"
    $action = 'install the no-signal watcher'
}
$sshArgs = @('-p', "$Port", '-i', $KeyPath, "root@$TvHost", $remote)
$cmd     = "ssh -p $Port -i `"$KeyPath`" root@$TvHost `"$remote`""
if ($ConfigureNas) { $cmd += " <<< $stdin" } elseif ($stdin) { $cmd += " < `"$shScript`"" }

if (-not $PSCmdlet.ShouldProcess("root@$TvHost", $action)) {
    Write-Output "would run: $cmd"
    exit 0
}

if (-not (Test-Path -LiteralPath $KeyPath)) {
    throw "SSH key not found at: $KeyPath"
}

Write-Output "running: $cmd"
if ($stdin) {
    $OutputEncoding = New-Object System.Text.UTF8Encoding $false
    # On a UTF-8 console (code page 65001) Windows PowerShell still writes a BOM
    # unless the console input encoding is BOM-less too; sh on the TV then
    # fails the first line.
    try { [Console]::InputEncoding = $OutputEncoding } catch { }
    $stdin | & ssh @sshArgs
} else {
    & ssh @sshArgs
}
if ($LASTEXITCODE -ne 0) {
    throw "ssh exited with code $LASTEXITCODE"
}
if ($Remove) {
    Write-Output "Removed. From the next boot no slideshow covers a dark HDMI input."
} elseif ($RemoveNas) {
    Write-Output "The slideshow uses the USB stick only from the next show."
} elseif ($ConfigureNas) {
    Write-Output "The slideshow tries the NAS first from the next show."
} else {
    Write-Output "Installed. It runs at the next boot (power-on, or reboot)."
}
