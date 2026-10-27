#!/bin/sh
# Limits LG Input Hook's injection to lginput2. Piped to the TV by
# scripts/inputhook-patch.ps1; runs as root.
#
# At boot LG Input Hook injects its library into every process named
# RELEASE, lginput2, micomservice, tvservice or testapp. On this TV the
# remap only runs in lginput2; the tvservice injection does nothing for it,
# but when the TV starts on an HDMI input it leaves tvservice unable to
# switch to Live TV or any other source (black screen until a cold start).
# Findings: docs/tv-log.md, 27 Oct.
#
# The original is kept as service.js.orig; --undo puts it back. Reinstalling
# or updating LG Input Hook undoes the patch: run it again.
#
# Takes effect at the next boot.

DIR=${INPUTHOOK_SERVICE_DIR:-/media/developer/apps/usr/palm/services/org.webosbrew.inputhook.service}
F=$DIR/service.js
ORIGINAL="var targetNames = \['RELEASE', 'lginput2', 'micomservice', 'tvservice', 'testapp'\];"
PATCHED="var targetNames = ['lginput2'];"

[ -f "$F" ] || { echo "LG Input Hook is not installed ($F)" >&2; exit 1; }

if [ "$1" = "--undo" ]; then
    [ -f "$F.orig" ] || { echo "no $F.orig: nothing to undo" >&2; exit 1; }
    mv -f "$F.orig" "$F"
elif grep -qxF "$PATCHED" "$F"; then
    echo "already patched"
elif grep -qx "$ORIGINAL" "$F"; then
    cp -p "$F" "$F.orig"
    sed -i "s/^$ORIGINAL\$/$PATCHED/" "$F"
else
    echo "unknown LG Input Hook version: no targetNames line to patch in $F" >&2
    exit 1
fi
sync
grep -n "^var targetNames" "$F"
