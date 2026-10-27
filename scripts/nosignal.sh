#!/bin/sh
# CustomWebOS no-signal slideshow watcher. Installed by scripts/nosignal.ps1
# as /var/lib/webosbrew/init.d/customwebos-nosignal; Homebrew Channel's
# startup.sh runs it once per boot, as root.
#
# When the HDMI input on screen loses its picture for SETTLE_S seconds and
# a USB stick has photos, it launches CustomWebOS with
# {"slideshow":{"input":"com.webos.app.hdmiN"}} over it; when the picture
# comes back, it relaunches the input. Changing the source ends the show by
# itself (CustomWebOS is hidden). Design: docs/superpowers/specs/
# 2026-10-27-no-signal-slideshow-design.md; findings: docs/tv-log.md.
#
# "Lost its picture" (com.webos.service.eim/getAllInputStatus): the
# device's "activate" is false (off or unplugged), or it had been sending
# its ID info (spd* fields, present only while it outputs video) and that
# is gone (e.g. a PS5 in rest mode). A device that never sends spd* is only
# covered when it switches off, so a working device is never covered.
#
# Event-driven: three luna-send subscriptions (current input, input states,
# foreground app) feed a FIFO; each event re-checks the state. The only
# timer is one background sleep for the settle delay. It never opens or
# switches inputs except by launching the HDMI app back (tv-notes).
#
# It also links <CustomWebOS dir>/usb to /tmp/usb: the app can't read the
# stick with file://, only through its own folder.
#
# Log: /tmp/nosignal.log (256 KB, one rotation).
# Undo: rm /var/lib/webosbrew/init.d/customwebos-nosignal && reboot
#
# --foreground runs it in the foreground; --decide … runs the decision
# alone (tests).

APP_ID=org.jazwinski.customwebos.home
APP_DIR=${APP_DIR:-/media/developer/apps/usr/palm/applications/$APP_ID}
USB_ROOT=${USB_ROOT:-/tmp/usb}
STATE=${STATE:-/tmp/nosignal}
LOG=${LOG:-/tmp/nosignal.log}
SETTLE_S=5
EIM=luna://com.webos.service.eim
AM=luna://com.webos.applicationManager
HOME_SERVICE=luna://org.jazwinski.customwebos.home.service

# decide CUR FG BLOCK SPDSEEN COVERING LOSTFOR -> none|wait|cover|uncover|clear
#   CUR      current input (HDMI_1…, DTV…)
#   FG       foreground app id
#   BLOCK    CUR's entry from getAllInputStatus, spaces removed
#   SPDSEEN  1 if CUR has sent spd* fields since boot
#   COVERING the input the slideshow covers, or -
#   LOSTFOR  seconds CUR has been without a picture (0 if not known)
decide() {
    cur=$1 fg=$2 block=$3 spdseen=$4 covering=$5 lostfor=$6
    case "$cur" in
        HDMI_[1-4]) ;;
        *) if [ "$covering" != "-" ]; then echo clear; else echo none; fi; return ;;
    esac
    if [ "$covering" != "-" ] && [ "$covering" != "$cur" ]; then echo clear; return; fi
    case "$block" in
        *'"activate":false'*) lost=1 ;;
        *'"spdVendorName"'*|*'"spdProductDescription"'*) lost=0 ;;
        *) if [ "$spdseen" = 1 ]; then lost=1; else lost=0; fi ;;
    esac
    if [ "$lost" = 0 ]; then
        if [ "$covering" = "$cur" ]; then echo uncover; else echo none; fi
        return
    fi
    if [ "$covering" = "$cur" ]; then echo none; return; fi
    if [ "$fg" != "com.webos.app.hdmi${cur#HDMI_}" ]; then echo none; return; fi
    if [ "$lostfor" -ge "$SETTLE_S" ]; then echo cover; else echo wait; fi
}

say() {
    size=$(wc -c < "$LOG" 2>/dev/null || echo 0)
    [ "$size" -gt 262144 ] && mv -f "$LOG" "$LOG.1"
    echo "$(date '+%F %T') nosignal: $*" >> "$LOG"
}

# One-shot luna call; prints the reply on one line without spaces.
ask() {
    luna-send -n 1 "$1" "$2" < /dev/null 2>/dev/null | tr -d ' \n'
}

uptime_s() {
    cut -d. -f1 /proc/uptime
}

# Re-reads the TV's state and acts on decide's answer.
check() {
    cur=$(ask "$EIM/getCurrentInput" '{}' | sed -n 's/.*"mainInputSourceId":"\([A-Z_0-9]*\)".*/\1/p')
    fg=$(ask "$AM/getForegroundAppInfo" '{}' | sed -n 's/.*"appId":"\([^"]*\)".*/\1/p')
    block=$(ask "$EIM/getAllInputStatus" '{}' | grep -o "\"id\":\"$cur\"[^}]*")
    case "$block" in *'"spdVendorName"'*|*'"spdProductDescription"'*) : > "$STATE/spd-$cur" ;; esac
    spdseen=0; [ -e "$STATE/spd-$cur" ] && spdseen=1
    covering=$(cat "$STATE/covering" 2>/dev/null || echo -)
    lostfor=0
    [ -e "$STATE/lost-$cur" ] && lostfor=$(( $(uptime_s) - $(cat "$STATE/lost-$cur") ))
    action=$(decide "$cur" "$fg" "$block" "$spdseen" "$covering" "$lostfor")
    case "$action" in
        wait)
            if [ ! -e "$STATE/lost-$cur" ]; then
                uptime_s > "$STATE/lost-$cur"
                (sleep "$SETTLE_S"; echo tick >&3) &
                say "$cur lost its picture; settling ${SETTLE_S}s"
            fi
            ;;
        cover)
            rm -f "$STATE/lost-$cur"
            if ask "$HOME_SERVICE/listPhotos" '{}' | grep -q '"usb/'; then
                n=${cur#HDMI_}
                luna-send -n 1 "$AM/launch" "{\"id\":\"$APP_ID\",\"params\":{\"slideshow\":{\"input\":\"com.webos.app.hdmi$n\"}}}" < /dev/null > /dev/null 2>&1
                echo "$cur" > "$STATE/covering"
                say "$cur covered with the slideshow"
            else
                say "$cur has no picture but the stick has no photos: LG's screen stays"
            fi
            ;;
        uncover)
            rm -f "$STATE/covering" "$STATE"/lost-*
            luna-send -n 1 "$AM/launch" "{\"id\":\"com.webos.app.hdmi${cur#HDMI_}\"}" < /dev/null > /dev/null 2>&1
            say "$cur has its picture back; input relaunched"
            ;;
        clear)
            rm -f "$STATE/covering" "$STATE"/lost-*
            say "source changed to $cur; slideshow left"
            ;;
        none)
            rm -f "$STATE"/lost-*
            ;;
    esac
}

# Keeps one subscription running, feeding the FIFO; restarts it after 5 s
# if luna-send exits.
subscribe() {
    while :; do
        luna-send -i "$1" '{"subscribe":true}' < /dev/null >&3 2>/dev/null
        sleep 5
    done
}

main() {
    mkdir -p "$STATE"
    rm -f "$STATE"/*
    [ -d "$APP_DIR" ] && ln -sfn "$USB_ROOT" "$APP_DIR/usb"
    mkfifo "$STATE/events"
    exec 3<> "$STATE/events"
    subscribe "$EIM/getCurrentInput" &
    subscribe "$EIM/getAllInputStatus" &
    subscribe "$AM/getForegroundAppInfo" &
    say "watching"
    while read -r _ <&3; do
        check
    done
}

case "$1" in
    --decide) shift; decide "$@" ;;
    --foreground) main ;;
    *) main < /dev/null > /dev/null 2>&1 & ;;
esac
exit 0
