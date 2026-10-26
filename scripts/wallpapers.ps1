<#
.SYNOPSIS
  Render the day/night wallpapers and their glass images from GNOME's Morphogenesis SVGs.

.DESCRIPTION
  In a throwaway ubuntu:24.04 container (librsvg + ImageMagick), downloads
  morphogenesis-l.svg (day) and morphogenesis-d.svg (night) from GNOME's
  gnome-backgrounds at a pinned commit, and writes into home/assets/wallpapers/:
    morphogenesis-day.jpg, morphogenesis-night.jpg            1920x1080, centre crop
    morphogenesis-day-dock.jpg, morphogenesis-night-dock.jpg  the same, blurred and tinted:
                                                              the glass behind the dock and clock
  The art is by Jakub Steiner (GNOME), CC BY-SA 3.0; the JPEGs stay CC BY-SA 3.0
  (see home/assets/wallpapers/SOURCES.json and the README).

  The glass tints are the knobs to tune on the TV: -DayTint/-NightTint (colour
  and percent). Rerun, then package and install.

.PARAMETER DayTint
  Day glass tint as "<#rrggbb> <percent>". Defaults to "#faf8f4 42".

.PARAMETER NightTint
  Night glass tint. Defaults to "#0a0c12 38".

.PARAMETER WhatIf
  Dry-run. Prints the docker command that would run and exits 0 without side effects.

.EXAMPLE
  powershell -NoProfile -File scripts/wallpapers.ps1 -WhatIf
  powershell -NoProfile -File scripts/wallpapers.ps1 -DayTint "#ffffff 50"
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$DayTint = '#faf8f4 42',
    [string]$NightTint = '#0a0c12 38'
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Split-Path -Parent $scriptDir
$outDir    = Join-Path $repoRoot 'home/assets/wallpapers'
$commit    = '0e0489d8366c5ba813f82f4c5aefb36831f3a155'
$base      = "https://gitlab.gnome.org/GNOME/gnome-backgrounds/-/raw/$commit/backgrounds"

foreach ($t in @($DayTint, $NightTint)) {
    if ($t -notmatch '^#[0-9a-fA-F]{6} \d{1,3}$') { throw "tint must look like '#rrggbb 40', got '$t'" }
}
$dayC, $dayP = $DayTint -split ' '
$nightC, $nightP = $NightTint -split ' '

# One pass per mode: render the square SVG 1920 wide, crop the middle 1920x1080,
# then blur and tint that crop for the glass. Qualities keep the files inside
# the budget (wallpaper <= 600 KB, glass <= 120 KB; test/home-assets.test.js).
$inner = 'set -e; apt-get update -qq && apt-get install -y -qq --no-install-recommends imagemagick librsvg2-bin curl ca-certificates > /dev/null; ' +
         'cd /tmp; ' +
         "render() { curl -fsSL -o `$1.svg $base/morphogenesis-`$1.svg; " +
         'rsvg-convert -w 1920 $1.svg -o $1.png; ' +
         'convert $1.png -gravity center -crop 1920x1080+0+0 +repage -strip -quality 90 /out/morphogenesis-$2.jpg; ' +
         'convert $1.png -gravity center -crop 1920x1080+0+0 +repage -blur 0x40 -fill "$3" -colorize $4 -strip -quality 82 /out/morphogenesis-$2-dock.jpg; }; ' +
         "render l day '$dayC' $dayP; render d night '$nightC' $nightP; ls -l /out/morphogenesis-*.jpg"

$runCmd = "docker run --rm -v `"${outDir}:/out`" ubuntu:24.04 bash -c '<render morphogenesis-l.svg (day) and morphogenesis-d.svg (night) at 1920x1080, plus -dock glass>'"

if (-not $PSCmdlet.ShouldProcess($outDir, 'docker run (render wallpapers)')) {
    Write-Output "would run: $runCmd"
    Write-Output "sources: $base/morphogenesis-l.svg, $base/morphogenesis-d.svg"
    Write-Output "output: $outDir (morphogenesis-day.jpg, morphogenesis-night.jpg and their -dock.jpg glass, 1920x1080)"
    exit 0
}

& docker run --rm -v "${outDir}:/out" ubuntu:24.04 bash -c $inner
if ($LASTEXITCODE -ne 0) { throw "docker run exited with code $LASTEXITCODE" }
