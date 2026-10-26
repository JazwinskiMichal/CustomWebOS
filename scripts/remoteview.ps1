<#
.SYNOPSIS
  Install (or remove) the remote view boot hook on the TV, store its VNC
  password, or pair it with the TV's second-screen API.

.DESCRIPTION
  Remote view is a VNC server for the TV's screen: the daemon ships in the
  .ipk at <service dir>/bin/remoteview (scripts/build-native.ps1, then
  scripts/package.ps1, then scripts/install.ps1).

  default       Streams scripts/remoteview.sh to the TV over SSH and writes it as
                /var/lib/webosbrew/init.d/customwebos-remoteview (mode 755). It
                starts the daemon at the next boot and keeps it running. CRs are
                stripped on the TV, since sh there chokes on them and PowerShell
                appends CRLF to piped input.
  -Remove       Deletes the hook and stops the running daemon (SIGINT, so it
                releases the capture; see docs/tv-notes.md).
  -SetPassword  Asks for the VNC password (hidden), saves it to
                .local/remoteview/password.txt and stores it on the TV through
                `remoteview --store-password`. VNC uses only the first 8 characters.
  -Pair         Runs `remoteview --pair` on the TV. Accept the prompt on the TV.

.PARAMETER TvHost
  TV's LAN IP or hostname.

.PARAMETER Remove
  Delete the hook and stop the daemon (rollback).

.PARAMETER SetPassword
  Set the VNC password.

.PARAMETER Pair
  Pair with the TV's second-screen API.

.PARAMETER Port
  SSH port. Defaults to 22022 (see docs/setup.md §3.3).

.PARAMETER KeyPath
  Private key for root. Defaults to ~/.ssh/id_ed25519_lgtv.

.PARAMETER WhatIf
  Dry-run. Prints the command and exits 0 (and asks nothing).

.EXAMPLE
  powershell -NoProfile -File scripts/remoteview.ps1 -TvHost 192.168.1.50 -WhatIf
  powershell -NoProfile -File scripts/remoteview.ps1 -TvHost 192.168.1.50 -SetPassword
  powershell -NoProfile -File scripts/remoteview.ps1 -TvHost 192.168.1.50 -Pair
  powershell -NoProfile -File scripts/remoteview.ps1 -TvHost 192.168.1.50 -Remove
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory=$true)][string]$TvHost,
    [switch]$Remove,
    [switch]$SetPassword,
    [switch]$Pair,
    [int]$Port = 22022,
    [string]$KeyPath = (Join-Path $env:USERPROFILE '.ssh\id_ed25519_lgtv')
)

$ErrorActionPreference = 'Stop'

if (@($Remove, $SetPassword, $Pair | Where-Object { $_ }).Count -gt 1) {
    throw 'Use at most one of -Remove, -SetPassword and -Pair.'
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Split-Path -Parent $scriptDir
$shScript  = Join-Path $scriptDir 'remoteview.sh'
$target    = '/var/lib/webosbrew/init.d/customwebos-remoteview'
$bin       = '/media/developer/apps/usr/palm/services/org.jazwinski.customwebos.home.service/bin/remoteview'
$pwFile    = Join-Path $repoRoot '.local/remoteview/password.txt'

# No double quotes in $remote: Windows PowerShell strips them from native
# command arguments. ares-package drops exec bits on Windows, hence the chmod.
$stdin = $null
if ($Remove) {
    # The stop file ends the hook's respawn loop; [b] keeps grep from matching itself.
    $remote = 'rm -f ' + $target + '; touch /tmp/remoteview.stop; ' +
              'for p in $(ps -ef | grep ''[b]in/remoteview'' | awk ''{print $2}''); do kill -INT $p; done; ' +
              'ls /var/lib/webosbrew/init.d'
    $action = 'remove the remote view hook and stop the daemon'
} elseif ($SetPassword) {
    $remote = "chmod 755 $bin && $bin --store-password"
    $action = 'store the remote view password'
} elseif ($Pair) {
    $remote = "chmod 755 $bin && $bin --pair"
    $action = 'pair remote view with the TV'
} else {
    if (-not (Test-Path -LiteralPath $shScript)) { throw "remoteview.sh not found at: $shScript" }
    $remote = "mkdir -p /var/lib/webosbrew/init.d && tr -d '\015' > $target && chmod 755 $target && ls -la $target"
    $action = 'install the remote view hook'
}
$sshArgs = @('-p', "$Port", '-i', $KeyPath, "root@$TvHost", $remote)
$cmd     = "ssh -p $Port -i `"$KeyPath`" root@$TvHost `"$remote`""
if (-not ($Remove -or $SetPassword -or $Pair)) { $cmd += " < `"$shScript`"" }
if ($SetPassword) { $cmd = "(password, then newline) | $cmd" }

if (-not $PSCmdlet.ShouldProcess("root@$TvHost", $action)) {
    Write-Output "would run: $cmd"
    if ($SetPassword) { Write-Output "would also save the password to: $pwFile" }
    exit 0
}

if (-not (Test-Path -LiteralPath $KeyPath)) {
    throw "SSH key not found at: $KeyPath"
}

# No BOM on piped input: on a UTF-8 console (code page 65001) Windows
# PowerShell still writes one unless the console input encoding is BOM-less too.
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = $OutputEncoding

if ($SetPassword) {
    $secure = Read-Host -Prompt 'VNC password' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    if (-not $plain) { throw 'The password is empty.' }
    if ($plain -match '[^ -~]') { throw 'The password has non-ASCII characters; viewers encode those differently, so it could never be typed. Use ASCII only.' }
    if ($plain.Length -gt 8) {
        Write-Warning 'VNC uses only the first 8 characters of the password; viewers accept anything that starts with them.'
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $pwFile) | Out-Null
    [IO.File]::WriteAllText($pwFile, $plain, (New-Object System.Text.UTF8Encoding $false))
    Write-Output "saved to $pwFile"
    Write-Output "running: $cmd"
    ($plain + "`n") | & ssh @sshArgs
} elseif ($Pair) {
    Write-Output "running: $cmd"
    Write-Output 'Accept the pairing prompt on the TV with the remote now.'
    & ssh @sshArgs
} elseif ($Remove) {
    Write-Output "running: $cmd"
    & ssh @sshArgs
} else {
    Write-Output "running: $cmd"
    ((Get-Content -LiteralPath $shScript -Raw) -replace "`r`n", "`n") | & ssh @sshArgs
}
if ($LASTEXITCODE -ne 0) {
    throw "ssh exited with code $LASTEXITCODE"
}
if ($Remove) {
    Write-Output 'Removed, and the daemon was told to stop. Also rm the hook from .local/webos/recovery.md if listed.'
} elseif ($SetPassword) {
    Write-Output 'Password stored on the TV.'
} elseif ($Pair) {
    Write-Output 'Paired.'
} else {
    Write-Output 'Installed. The daemon starts at the next boot (power-on, or reboot).'
}
