<#
.SYNOPSIS
  Cross-compile native/remoteview for the TV (ARM) in Docker, or run its host unit tests.

.DESCRIPTION
  Builds the Docker image customwebos-remoteview-build (cached after the first
  run) from native/remoteview/Dockerfile, then runs it with the repo mounted
  at /src.
    default: cross-compiles into dist/native/remoteview/remoteview
    -Test:   builds the unit tests with host gcc and runs ctest; the exit
             code is ctest's.

.PARAMETER Test
  Build and run the host unit tests instead of the ARM binary.

.PARAMETER WhatIf
  Dry-run. Prints the docker commands that would run and exits 0 without
  side effects.

.EXAMPLE
  powershell -NoProfile -File scripts/build-native.ps1 -WhatIf
  powershell -NoProfile -File scripts/build-native.ps1
  powershell -NoProfile -File scripts/build-native.ps1 -Test
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$Test
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Split-Path -Parent $scriptDir
$srcDir    = Join-Path $repoRoot 'native/remoteview'
$outDir    = Join-Path $repoRoot 'dist/native/remoteview'
$image     = 'customwebos-remoteview-build'

if ($Test) {
    $inner = 'cmake -S native/remoteview -B dist/native/build-host -DREMOTEVIEW_HOST_TESTS=ON && ' +
             'cmake --build dist/native/build-host && ' +
             'cd dist/native/build-host && ctest --output-on-failure'
} else {
    $inner = 'cmake -S native/remoteview -B dist/native/build-arm -DCMAKE_TOOLCHAIN_FILE=$TOOLCHAIN_FILE -DCMAKE_BUILD_TYPE=Release && ' +
             'cmake --build dist/native/build-arm && ' +
             'mkdir -p dist/native/remoteview && cp dist/native/build-arm/remoteview dist/native/remoteview/remoteview'
}

$buildCmd = "docker build -t $image `"$srcDir`""
$runCmd   = "docker run --rm -v `"${repoRoot}:/src`" $image bash -c '$inner'"

if (-not $PSCmdlet.ShouldProcess($outDir, 'docker build and run')) {
    Write-Output "would run: $buildCmd"
    Write-Output "would run: $runCmd"
    Write-Output "output: $outDir"
    exit 0
}

& docker build -t $image $srcDir
if ($LASTEXITCODE -ne 0) { throw "docker build exited with code $LASTEXITCODE" }

& docker run --rm -v "${repoRoot}:/src" $image bash -c $inner
$rc = $LASTEXITCODE
if ($Test) { exit $rc }
if ($rc -ne 0) { throw "docker run exited with code $rc" }
Write-Output (Join-Path $outDir 'remoteview')
