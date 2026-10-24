<#
.SYNOPSIS
  Build the CustomWebOS home app .ipk using LG's ares-package.

.DESCRIPTION
  Validates home/appinfo.json, ensures dist/ exists, then calls:
      ares-package home/ -o dist/
  Prints the resulting .ipk filename on stdout when the real run completes.

.PARAMETER WhatIf
  Dry-run. Prints the exact ares-package command that would run and exits 0
  without side effects.

.EXAMPLE
  powershell -NoProfile -File scripts/package.ps1 -WhatIf
  powershell -NoProfile -File scripts/package.ps1
#>
[CmdletBinding(SupportsShouldProcess)]
param()

$ErrorActionPreference = 'Stop'

# Resolve repo root from the script's own location so the script works
# regardless of the shell's current directory.
$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot   = Split-Path -Parent $scriptDir
$homeDir    = Join-Path $repoRoot 'home'
$serviceDir = Join-Path $repoRoot 'services/org.jazwinski.customwebos.home.service'
$distDir    = Join-Path $repoRoot 'dist'
$appinfo    = Join-Path $homeDir 'appinfo.json'

if (-not (Test-Path -LiteralPath $appinfo)) {
    throw "home/appinfo.json not found at: $appinfo"
}
try {
    $null = Get-Content -LiteralPath $appinfo -Raw | ConvertFrom-Json -ErrorAction Stop
} catch {
    throw "home/appinfo.json is not valid JSON: $($_.Exception.Message)"
}

$sources = @($homeDir)
if (Test-Path -LiteralPath $serviceDir) {
    $sources += $serviceDir
}

$cmd = "ares-package " + (($sources | ForEach-Object { '"' + $_ + '"' }) -join ' ') + " -o `"$distDir`""

if (-not $PSCmdlet.ShouldProcess($distDir, 'ares-package')) {
    Write-Output "would run: $cmd"
    foreach ($s in $sources) { Write-Output "source: $s" }
    Write-Output "output: $distDir"
    exit 0
}

if (-not (Test-Path -LiteralPath $distDir)) {
    New-Item -ItemType Directory -Path $distDir | Out-Null
}

Write-Output "running: $cmd"
& ares-package @sources -o $distDir
if ($LASTEXITCODE -ne 0) {
    throw "ares-package exited with code $LASTEXITCODE"
}
$built = Get-ChildItem -LiteralPath $distDir -Filter '*.ipk' |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($built) { Write-Output $built.FullName }
