<#
.SYNOPSIS
  Build the CustomWebOS home app .ipk using LG's ares-package.

.DESCRIPTION
  Validates home/appinfo.json, stages home/, the service and the remote view
  daemon (from scripts/build-native.ps1: bin/remoteview, its two capture
  backends, libjpeg.so.8 and its licence) into dist/stage/, then calls:
      ares-package dist/stage/home dist/stage/<service> -o dist/
  then packages the doorbell box (doorbell/, its own app id) the same way:
      ares-package dist/stage/doorbell -o dist/
  Prints the resulting .ipk filenames on stdout when the real run completes.

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
$doorbellDir = Join-Path $repoRoot 'doorbell'
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

# ares-package packages whole directories, so the daemon is staged next to
# the service as bin/ (installed at <service dir>/bin/, where the boot hook
# looks for it).
$stageDir   = Join-Path $distDir 'stage'
$nativeDir  = Join-Path $repoRoot 'dist/native/remoteview'
$nativeFiles = @('remoteview', 'libdile_vt_backend.so', 'libgm_backend.so', 'libjpeg.so.8', 'LICENSE.libjpeg-turbo')
$stageHome  = Join-Path $stageDir 'home'
$sources = @($stageHome)
$stageService = $null
if (Test-Path -LiteralPath $serviceDir) {
    $stageService = Join-Path $stageDir (Split-Path -Leaf $serviceDir)
    $sources += $stageService
}

$cmd = "ares-package " + (($sources | ForEach-Object { '"' + $_ + '"' }) -join ' ') + " -o `"$distDir`""
$stageDoorbell = Join-Path $stageDir 'doorbell'
$doorbellCmd = "ares-package `"$stageDoorbell`" -o `"$distDir`""

if (-not $PSCmdlet.ShouldProcess($distDir, 'ares-package')) {
    Write-Output "would stage: $homeDir to $stageHome"
    if ($stageService) {
        Write-Output "would stage: $serviceDir to $stageService"
        foreach ($f in $nativeFiles) { Write-Output "would stage: $(Join-Path $nativeDir $f) to $(Join-Path $stageService "bin/$f")" }
    }
    Write-Output "would run: $cmd"
    Write-Output "would stage: $doorbellDir to $stageDoorbell"
    Write-Output "would run: $doorbellCmd"
    foreach ($s in $sources) { Write-Output "source: $s" }
    Write-Output "output: $distDir"
    exit 0
}

if (-not (Test-Path -LiteralPath $distDir)) {
    New-Item -ItemType Directory -Path $distDir | Out-Null
}

if ($stageService) {
    foreach ($f in $nativeFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $nativeDir $f))) {
            throw "dist/native/remoteview/$f is missing: run scripts/build-native.ps1 first"
        }
    }
}
if (Test-Path -LiteralPath $stageDir) { Remove-Item -LiteralPath $stageDir -Recurse -Force }
New-Item -ItemType Directory -Path $stageDir | Out-Null
Copy-Item -LiteralPath $homeDir -Destination $stageHome -Recurse
Copy-Item -LiteralPath $doorbellDir -Destination $stageDoorbell -Recurse
if ($stageService) {
    Copy-Item -LiteralPath $serviceDir -Destination $stageService -Recurse
    $stageBin = Join-Path $stageService 'bin'
    New-Item -ItemType Directory -Path $stageBin | Out-Null
    foreach ($f in $nativeFiles) { Copy-Item -LiteralPath (Join-Path $nativeDir $f) -Destination $stageBin }
}

Write-Output "running: $cmd"
& ares-package @sources -o $distDir
if ($LASTEXITCODE -ne 0) {
    throw "ares-package exited with code $LASTEXITCODE"
}
Write-Output "running: $doorbellCmd"
& ares-package $stageDoorbell -o $distDir
if ($LASTEXITCODE -ne 0) {
    throw "ares-package (doorbell) exited with code $LASTEXITCODE"
}
foreach ($id in @('home', 'doorbell')) {
    $built = Get-ChildItem -LiteralPath $distDir -Filter "org.jazwinski.customwebos.$id*.ipk" |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($built) { Write-Output $built.FullName }
}
