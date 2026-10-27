#!/bin/sh
# CustomWebOS autostart. Installed by scripts/autostart.ps1 as
# /var/lib/webosbrew/init.d/customwebos-autostart; Homebrew Channel's
# startup.sh runs it once per boot, as root, alongside its other hooks.
#
# Waits (in the background, so the other hooks aren't held up) until
# applicationManager answers, then opens CustomWebOS at once. If the TV had
# reopened CustomWebOS by itself, that instance is closed and opened again:
# one opened before the app's bus permissions were loaded stays stuck
# (docs/tv-log.md).
#
# luna-send always gets /dev/null as stdin: with a pipe there (run-parts,
# ssh) it prints nothing and still exits 0.
#
# Undo: rm /var/lib/webosbrew/init.d/customwebos-autostart && reboot
# Then, if LG Input Hook is installed (it maps the Home button to
# CustomWebOS, docs/home-button.md), it waits for the hook to be injected
# and stops LG Input Hook's service: the remap lives in the injected
# library, and the service's only remaining job is a config server on port
# 1842 that can run commands as root. Opening LG Input Hook's app starts
# it again until the next boot.
#
# --foreground runs it in the foreground (tests).

APP='{"id":"org.jazwinski.customwebos.home"}'
AM=luna://com.webos.applicationManager
OUT=/tmp/customwebos-autostart.txt
INPUTHOOK_DIR=${INPUTHOOK_DIR:-/media/developer/apps/usr/palm/applications/org.webosbrew.inputhook}
INPUTHOOK_MARKER=${INPUTHOOK_MARKER:-/tmp/inputhook}   # written once it has injected
KILL=${KILL:-kill}

main() {
    i=0
    until luna-send -n 1 "$AM/getForegroundAppInfo" '{}' < /dev/null > "$OUT" 2>&1 && grep -q returnValue "$OUT"; do
        i=$((i + 1))
        [ "$i" -ge 120 ] && return 0   # ~4 min of 2 s tries: give up quietly
        sleep 2
    done
    # Open CustomWebOS the moment the bus answers: the TV restored its last
    # input long before (+18 s against +40 s for the hooks, tv-log). Only an
    # instance the TV reopened by itself may be stuck, so only that one is
    # closed and opened again.
    if grep -q '"appId":"org.jazwinski.customwebos.home"' "$OUT"; then
        luna-send -n 1 "$AM/closeByAppId" "$APP" < /dev/null > /dev/null 2>&1
        sleep 1
    fi
    luna-send -n 1 "$AM/launch" "$APP" < /dev/null > "$OUT" 2>&1
    stop_inputhook_server
    return 0
}

stop_inputhook_server() {
    [ -d "$INPUTHOOK_DIR" ] || return 0
    i=0
    until [ -e "$INPUTHOOK_MARKER" ]; do
        i=$((i + 1))
        [ "$i" -ge 120 ] && return 0
        sleep 2
    done
    sleep 5   # let its own boot script read the service's reply first
    for pid in $(ps -ef | awk '$8 == "org.webosbrew.inputhook.service" {print $2}'); do
        $KILL "$pid"
    done
}

if [ "$1" = "--foreground" ]; then
    main
else
    main < /dev/null > /dev/null 2>&1 &
fi
exit 0
