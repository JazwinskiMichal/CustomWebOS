<#
.SYNOPSIS
  Measure CustomWebOS Home on the TV with its perf mode.

.DESCRIPTION
  Over one SSH session: closes the home app, relaunches it with
  {"perf": {action, steps, intervalMs}} as launch params, waits for the app
  to report, and prints the report. In perf mode the app notes when its
  first screen and its first app list render, then steps focus Steps times
  (as the remote's arrow keys would) while sampling frame times, and sends
  the numbers to the home service, which writes /tmp/customwebos-perf.json.

  The remote script is piped over stdin: Windows PowerShell strips the
  double quotes the launch JSON needs from native-command arguments. luna-send
  output goes to files, never a pipe (it gets lost under timeout; see
  docs/m2-tracking.md).

.PARAMETER TvHost
  TV's LAN IP or hostname.

.PARAMETER Action
  Focus direction to step: right (dock), left, down (the old list), up.

.PARAMETER Steps
  How many focus steps. Defaults to 40.

.PARAMETER IntervalMs
  Delay between steps. Defaults to 80.

.PARAMETER Port
  SSH port. Defaults to 22022 (see docs/setup.md §3.3).

.PARAMETER KeyPath
  Private key for root. Defaults to ~/.ssh/id_ed25519_lgtv.

.PARAMETER WhatIf
  Dry-run. Prints the remote script and exits 0.

.EXAMPLE
  powershell -NoProfile -File scripts/perf.ps1 -TvHost 192.168.88.244 -Action right -Steps 9 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory=$true)][string]$TvHost,
    [ValidateSet('right', 'left', 'down', 'up')][string]$Action = 'right',
    [int]$Steps = 40,
    [int]$IntervalMs = 80,
    [int]$Port = 22022,
    [string]$KeyPath = (Join-Path $env:USERPROFILE '.ssh\id_ed25519_lgtv')
)

$ErrorActionPreference = 'Stop'

$appId  = 'org.jazwinski.customwebos.home'
$out    = '/tmp/customwebos-perf.json'
$launch = '{"id":"' + $appId + '","params":{"perf":{"action":"' + $Action + '","steps":' + $Steps + ',"intervalMs":' + $IntervalMs + '}}}'
$close  = '{"id":"' + $appId + '"}'

$lines = @(
    # After some boots luna-send returns nothing (rc 0) for minutes, and a
    # close or launch sent then is lost; wait until the bus really answers.
    "i=0; until luna-send -n 1 luna://com.webos.applicationManager/getForegroundAppInfo '{}' < /dev/null > /tmp/perf-ready.txt 2>&1 && grep -q returnValue /tmp/perf-ready.txt; do [ `$i -ge 60 ] && echo 'bus not answering after 5 min' && exit 1; sleep 5; i=`$((i+1)); done",
    "rm -f $out",
    "luna-send -n 1 luna://com.webos.applicationManager/closeByAppId '$close' < /dev/null > /tmp/perf-close.txt 2>&1",
    'sleep 2',
    "luna-send -n 1 luna://com.webos.applicationManager/launch '$launch' < /dev/null > /tmp/perf-launch.txt 2>&1",
    'cat /tmp/perf-launch.txt; echo',
    "i=0; while [ ! -s $out ] && [ `$i -lt 30 ]; do sleep 2; i=`$((i+1)); done",
    "if [ -s $out ]; then cat $out; echo; else echo 'no perf report within 60 s'; exit 1; fi"
)
$body    = ($lines -join "`n") + "`nexit `$?`n"
$sshArgs = @('-p', "$Port", '-i', $KeyPath, "root@$TvHost", 'sh -s')
$cmd     = "ssh -p $Port -i `"$KeyPath`" root@$TvHost `"sh -s`""

if (-not $PSCmdlet.ShouldProcess("root@$TvHost", 'perf run')) {
    Write-Output "would run: $cmd"
    Write-Output "with this script on stdin:"
    $lines | ForEach-Object { Write-Output "  $_" }
    exit 0
}

if (-not (Test-Path -LiteralPath $KeyPath)) {
    throw "SSH key not found at: $KeyPath"
}

# UTF-8 without BOM, LF only (sh on the TV chokes on CR); the trailing exit
# stops sh before it reads the CRLF PowerShell appends to piped input.
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
Write-Output "running: $cmd"
$body | & ssh @sshArgs
if ($LASTEXITCODE -ne 0) {
    throw "perf run failed (ssh exit $LASTEXITCODE)"
}
