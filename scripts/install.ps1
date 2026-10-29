<#
.SYNOPSIS
  Install the CustomWebOS home .ipk onto the TV.

.DESCRIPTION
  Picks the most recent org.jazwinski.customwebos.home*.ipk from dist/, and
  the most recent org.jazwinski.customwebos.doorbell*.ipk if there is one
  (the doorbell box), and installs them one of two ways:

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
[CmdletBinding(DefaultParameterSetName='Ares', SupportsShouldProcess)]
param(
    [Parameter(Mandatory=$true, ParameterSetName='Ares')][string]$Device,
    [Parameter(Mandatory=$true, ParameterSetName='Ssh')][string]$TvHost,
    [Parameter(ParameterSetName='Ssh')][int]$Port = 22022,
    [Parameter(ParameterSetName='Ssh')][string]$KeyPath = (Join-Path $env:USERPROFILE '.ssh\id_ed25519_lgtv'),
    [Parameter(ParameterSetName='Ssh')][switch]$Reboot
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

$doorbellIpk = Get-ChildItem -LiteralPath $distDir -Filter 'org.jazwinski.customwebos.doorbell*.ipk' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $doorbellIpk) { Write-Warning "no org.jazwinski.customwebos.doorbell*.ipk in dist/; installing CustomWebOS Home only" }
$ipks = @($ipk) + @($doorbellIpk | Where-Object { $_ })

if ($PSCmdlet.ParameterSetName -eq 'Ares') {
    if (-not $PSCmdlet.ShouldProcess($Device, 'ares-install')) {
        foreach ($p in $ipks) { Write-Output "would run: ares-install -d $Device `"$($p.FullName)`"" }
        Write-Output "device: $Device"
        foreach ($p in $ipks) { Write-Output "ipk: $($p.FullName)" }
        exit 0
    }

    foreach ($p in $ipks) {
        Write-Output "running: ares-install -d $Device `"$($p.FullName)`""
        & ares-install -d $Device $p.FullName
        if ($LASTEXITCODE -ne 0) {
            throw "ares-install exited with code $LASTEXITCODE"
        }
    }
    exit 0
}

# The service's process title is exactly its id (column 8 of ps -ef); match
# that rather than pkill -f, which would also match this ssh session's shell.
# No double quotes in $remote: Windows PowerShell strips them when passing
# arguments to native commands.
$serviceRe = '^org\.jazwinski\.customwebos\.home\.service$'
# One install per .ipk. Only the home install decides rc (and the reboot): the
# doorbell box often has the version already installed, which opkg refuses.
$remote    = ''
foreach ($p in $ipks) {
    $remoteIpk = "/tmp/$($p.Name)"
    $remote += "ApplicationInstallerUtility -c install -t developer -p $remoteIpk -f /etc/palm/appinstalld/opkg.conf; "
    $remote += if ($p -eq $ipk) { "rc=`$?; rm -f $remoteIpk; " } else { "rm -f $remoteIpk; " }
}
$remote   += "for p in `$(ps -ef | awk '`$8 ~ /$serviceRe/ {print `$2}'); do kill `$p; done; "
if ($Reboot) { $remote += "[ `$rc -eq 0 ] && reboot; " }
$remote   += "exit `$rc"
$sshArgs   = @('-p', "$Port", '-i', $KeyPath, "root@$TvHost", $remote)
$sshCmd    = "ssh -p $Port -i `"$KeyPath`" root@$TvHost `"$remote`""

if (-not $PSCmdlet.ShouldProcess("root@$TvHost", 'install over ssh')) {
    foreach ($p in $ipks) { Write-Output "would run: scp -P $Port -i `"$KeyPath`" `"$($p.FullName)`" root@${TvHost}:/tmp/$($p.Name)" }
    Write-Output "would run: $sshCmd"
    Write-Output "host: $TvHost"
    foreach ($p in $ipks) { Write-Output "ipk: $($p.FullName)" }
    exit 0
}

if (-not (Test-Path -LiteralPath $KeyPath)) {
    throw "SSH key not found at: $KeyPath"
}

foreach ($p in $ipks) {
    Write-Output "running: scp -P $Port -i `"$KeyPath`" `"$($p.FullName)`" root@${TvHost}:/tmp/$($p.Name)"
    & scp -P "$Port" -i $KeyPath $p.FullName "root@${TvHost}:/tmp/$($p.Name)"
    if ($LASTEXITCODE -ne 0) {
        throw "scp exited with code $LASTEXITCODE"
    }
}

Write-Output "running: $sshCmd"
& ssh @sshArgs
if ($LASTEXITCODE -ne 0) {
    throw "ApplicationInstallerUtility exited with code $LASTEXITCODE"
}

if ($Reboot) {
    Write-Output "TV is rebooting. Open CustomWebOS once SSH is back (~40 s); if the TV reopened it by itself, close it and open it again."
} else {
    Write-Warning "Reboot the TV before testing: until then the hub drops every call from the app to the home service (the app shows its fallback list). Next time pass -Reboot."
}
