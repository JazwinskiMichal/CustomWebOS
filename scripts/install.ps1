<#
.SYNOPSIS
  Install the CustomWebOS home .ipk onto the TV.

.DESCRIPTION
  Picks the most recent org.jazwinski.customwebos.home*.ipk from dist/ and
  installs it one of two ways:

  -Device <name>   ares-install -d <name> <ipk>. ares-install handles
                   upgrade in place; no pre-uninstall step.

  -TvHost <ip>     Over SSH, for when ares-cli is broken (ares-cli 2.4.0
                   fails on Node 25). Copies the .ipk to /tmp/ on the TV,
                   runs ApplicationInstallerUtility with the explicit opkg
                   conf this firmware needs and -t developer (without it the
                   app lands in /media/cryptofs/apps as an internal app,
                   alongside the developer copy the service registration
                   points at), then stops the running home
                   service so the hub respawns it from the new code on the
                   next call.

  Reboot after every install. An upgrade resets the hub's runtime
  permissions for the web app (seen on-device: the registration files are
  untouched, ls-control scan-services doesn't help, a reboot does). Until
  then, every call from the app to the home service is silently dropped and
  the app shows its fallback list. -Reboot does it for you on the SSH route.

.PARAMETER Device
  Name of the device as registered with ares-setup-device.

.PARAMETER TvHost
  TV's LAN IP or hostname (SSH route).

.PARAMETER Port
  SSH port for -TvHost. Defaults to 22022 (see docs/setup.md §3.3).

.PARAMETER KeyPath
  Private key for root, for -TvHost. Defaults to ~/.ssh/id_ed25519_lgtv.

.PARAMETER Reboot
  SSH route only: reboot the TV after a successful install (see above).

.PARAMETER WhatIf
  Dry-run. Prints the command(s) that would run and exits 0.

.EXAMPLE
  powershell -NoProfile -File scripts/install.ps1 -Device tv -WhatIf
  powershell -NoProfile -File scripts/install.ps1 -Device tv
  powershell -NoProfile -File scripts/install.ps1 -TvHost 192.168.1.50 -WhatIf
#>
[CmdletBinding(DefaultParameterSetName='Ares')]
param(
    [Parameter(Mandatory=$true, ParameterSetName='Ares')][string]$Device,
    [Parameter(Mandatory=$true, ParameterSetName='Ssh')][string]$TvHost,
    [Parameter(ParameterSetName='Ssh')][int]$Port = 22022,
    [Parameter(ParameterSetName='Ssh')][string]$KeyPath = (Join-Path $env:USERPROFILE '.ssh\id_ed25519_lgtv'),
    [Parameter(ParameterSetName='Ssh')][switch]$Reboot,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Split-Path -Parent $scriptDir
$distDir   = Join-Path $repoRoot 'dist'

if (-not (Test-Path -LiteralPath $distDir)) {
    throw "dist/ not found; run scripts/package.ps1 first"
}

$ipk = Get-ChildItem -LiteralPath $distDir -Filter 'org.jazwinski.customwebos.home*.ipk' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not $ipk) {
    throw "no org.jazwinski.customwebos.home*.ipk in dist/; run scripts/package.ps1 first"
}

if ($PSCmdlet.ParameterSetName -eq 'Ares') {
    $cmd = "ares-install -d $Device `"$($ipk.FullName)`""

    if ($WhatIf) {
        Write-Output "would run: $cmd"
        Write-Output "device: $Device"
        Write-Output "ipk: $($ipk.FullName)"
        exit 0
    }

    Write-Output "running: $cmd"
    & ares-install -d $Device $ipk.FullName
    if ($LASTEXITCODE -ne 0) {
        throw "ares-install exited with code $LASTEXITCODE"
    }
    exit 0
}

$remoteIpk = "/tmp/$($ipk.Name)"
# The service's process title is exactly its id (column 8 of ps -ef); match
# that rather than pkill -f, which would also match this ssh session's shell.
# No double quotes in $remote: Windows PowerShell strips them when passing
# arguments to native commands.
$serviceRe = '^org\.jazwinski\.customwebos\.home\.service$'
$remote    = "ApplicationInstallerUtility -c install -t developer -p $remoteIpk -f /etc/palm/appinstalld/opkg.conf; rc=`$?; rm -f $remoteIpk; " +
             "for p in `$(ps -ef | awk '`$8 ~ /$serviceRe/ {print `$2}'); do kill `$p; done; "
if ($Reboot) { $remote += "[ `$rc -eq 0 ] && reboot; " }
$remote   += "exit `$rc"
$scpArgs   = @('-P', "$Port", '-i', $KeyPath, $ipk.FullName, "root@${TvHost}:$remoteIpk")
$sshArgs   = @('-p', "$Port", '-i', $KeyPath, "root@$TvHost", $remote)
$scpCmd    = "scp -P $Port -i `"$KeyPath`" `"$($ipk.FullName)`" root@${TvHost}:$remoteIpk"
$sshCmd    = "ssh -p $Port -i `"$KeyPath`" root@$TvHost `"$remote`""

if ($WhatIf) {
    Write-Output "would run: $scpCmd"
    Write-Output "would run: $sshCmd"
    Write-Output "host: $TvHost"
    Write-Output "ipk: $($ipk.FullName)"
    exit 0
}

if (-not (Test-Path -LiteralPath $KeyPath)) {
    throw "SSH key not found at: $KeyPath"
}

Write-Output "running: $scpCmd"
& scp @scpArgs
if ($LASTEXITCODE -ne 0) {
    throw "scp exited with code $LASTEXITCODE"
}

Write-Output "running: $sshCmd"
& ssh @sshArgs
if ($LASTEXITCODE -ne 0) {
    throw "ApplicationInstallerUtility exited with code $LASTEXITCODE"
}

if ($Reboot) {
    Write-Output "TV is rebooting. The luna bus takes ~5 min to answer after boot; the app retries on its own."
} else {
    Write-Warning "Reboot the TV before testing: until then the hub drops every call from the app to the home service (the app shows its fallback list). Next time pass -Reboot."
}
