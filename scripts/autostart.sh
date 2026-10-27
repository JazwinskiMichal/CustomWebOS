#!/bin/sh
# CustomWebOS boot hook. Installed by scripts/autostart.ps1 as
# /var/lib/webosbrew/init.d/customwebos-autostart; Homebrew Channel's
# startup.sh runs it once per boot, as root, alongside its other hooks.
#
# It no longer opens CustomWebOS at power-on: the owner wants it only
# behind the Home button (LG Input Hook, docs/home-button.md), and the TV
# stays on whatever source it starts on.
#
# Its one job: if LG Input Hook is installed, wait (in the background, so
# the other hooks aren't held up) for the hook to be injected, then stop
# LG Input Hook's service. The remap lives in the injected library, and the
# service's only remaining job is a config server on port 1842 that can run
# commands as root. Opening LG Input Hook's app starts it again until the
# next boot.
#
# Undo: rm /var/lib/webosbrew/init.d/customwebos-autostart && reboot
#
# --foreground runs it in the foreground (tests).

INPUTHOOK_DIR=${INPUTHOOK_DIR:-/media/developer/apps/usr/palm/applications/org.webosbrew.inputhook}
INPUTHOOK_MARKER=${INPUTHOOK_MARKER:-/tmp/inputhook}   # written once it has injected
KILL=${KILL:-kill}

main() {
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
    return 0
}

if [ "$1" = "--foreground" ]; then
    main
else
    main < /dev/null > /dev/null 2>&1 &
fi
exit 0
