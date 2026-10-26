#!/bin/sh
# CustomWebOS autostart. Installed by scripts/autostart.ps1 as
# /var/lib/webosbrew/init.d/customwebos-autostart; Homebrew Channel's
# startup.sh runs it once per boot, as root, alongside its other hooks.
#
# Waits (in the background, so the other hooks aren't held up) until
# applicationManager answers, gives the TV a moment to restore its last app,
# then closes and reopens CustomWebOS. Reopening also replaces an instance
# the TV may have opened before the app's bus permissions were loaded,
# which would otherwise stay stuck (docs/m2-tracking.md).
#
# luna-send always gets /dev/null as stdin: with a pipe there (run-parts,
# ssh) it prints nothing and still exits 0.
#
# Undo: rm /var/lib/webosbrew/init.d/customwebos-autostart && reboot
# --foreground runs it in the foreground (tests).

APP='{"id":"org.jazwinski.customwebos.home"}'
AM=luna://com.webos.applicationManager
OUT=/tmp/customwebos-autostart.txt

main() {
    i=0
    until luna-send -n 1 "$AM/getForegroundAppInfo" '{}' < /dev/null > "$OUT" 2>&1 && grep -q returnValue "$OUT"; do
        i=$((i + 1))
        [ "$i" -ge 120 ] && return 0   # ~4 min of 2 s tries: give up quietly
        sleep 2
    done
    sleep 5
    luna-send -n 1 "$AM/closeByAppId" "$APP" < /dev/null > /dev/null 2>&1
    sleep 2
    luna-send -n 1 "$AM/launch" "$APP" < /dev/null > "$OUT" 2>&1
    return 0
}

if [ "$1" = "--foreground" ]; then
    main
else
    main < /dev/null > /dev/null 2>&1 &
fi
exit 0
