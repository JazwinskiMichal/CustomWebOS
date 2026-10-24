<#
.SYNOPSIS
  Install the CustomWebOS home .ipk onto a registered ares device.

.DESCRIPTION
  Picks the most recent org.jazwinski.customwebos.home*.ipk from dist/
  and calls ares-install -d <Device> <path>. ares-install handles
  upgrade in place; no pre-uninstall step.

.PARAMETER Device
  Name of the device as registered with ares-setup-device.

.PARAMETER WhatIf
  Dry-run. Prints the ares-install command that would run and exits 0.

.EXAMPLE
  powershell -NoProfile -File scripts/install.ps1 -Device tv -WhatIf
  powershell -NoProfile -File scripts/install.ps1 -Device tv
#>
param(
    [Parameter(Mandatory=$true)][string]$Device,
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
