#!/bin/sh
# CustomWebOS remote view (VNC server for the TV's screen). Installed by
# scripts/remoteview.ps1 as /var/lib/webosbrew/init.d/customwebos-remoteview;
# Homebrew Channel's startup.sh runs it once per boot, as root.
#
# Runs the daemon in the background (so the other hooks aren't held up), at
# a low priority, and starts it again after it exits: 5 s later, doubling to
# at most 300 s; the delay resets once a run lasted 10 minutes. If the
# daemon isn't installed, it does nothing.
#
# This TV's PmLogDaemon drops syslog and logger lines, so the hook's own
# lines and the daemon's stdout and stderr go to /tmp/remoteview.log. Over
# 256 KB, that file moves to /tmp/remoteview.log.1 before each (re)start.
#
# Undo: rm /var/lib/webosbrew/init.d/customwebos-remoteview && reboot
# (scripts/remoteview.ps1 -Remove also stops the running daemon.)
#
# --foreground runs it in the foreground (tests). BIN, LOG and STOP can be
# overridden (tests); creating the STOP file ends the loop.

BIN=${BIN:-/media/developer/apps/usr/palm/services/org.jazwinski.customwebos.home.service/bin/remoteview}
LOG=${LOG:-/tmp/remoteview.log}
STOP=${STOP:-/tmp/remoteview.stop}

say() {
    echo "$(date '+%F %T') remoteview-hook: $*" >> "$LOG"
}

rotate() {
    size=$(wc -c < "$LOG" 2>/dev/null || echo 0)
    [ "$size" -gt 262144 ] && mv -f "$LOG" "$LOG.1"
    return 0
}

main() {
    [ -e "$BIN" ] || return 0
    chmod 755 "$BIN"   # ares-package on Windows drops the exec bits
    rm -f "$STOP"
    delay=5
    while [ ! -e "$STOP" ]; do
        rotate
        say "starting $BIN"
        began=$(date +%s)
        nice -n 10 "$BIN" >> "$LOG" 2>&1 < /dev/null
        rc=$?
        ran=$(($(date +%s) - began))
        [ "$ran" -ge 600 ] && delay=5
        say "exited with $rc after ${ran}s; restarting in ${delay}s"
        sleep "$delay"
        delay=$((delay * 2))
        [ "$delay" -gt 300 ] && delay=300
    done
    say "stopped"
    return 0
}

if [ "$1" = "--foreground" ]; then
    main
else
    main < /dev/null > /dev/null 2>&1 &
fi
exit 0
