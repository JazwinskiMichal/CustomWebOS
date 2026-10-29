#!/bin/sh
# Register the CustomWebOS home service with the luna-service2 hub on the TV.
# Writes the eleven files the hub needs Hbchannel-style, then nudges the hub.
# Idempotent — safe to re-run.
#   service side: services.d, roles.d, two api-permissions.d, two
#                 client-permissions.d
#   app side:     roles.d + client-permissions.d for the webapp itself. Without
#                 these the webapp has no bus role, and every call it makes is
#                 refused with -1031 "LSCallFromApplication ... not privileged".
#                 The same two again for the doorbell box.
#   manifests.d:  the entry that enumerates all of the above
#
# Runs on the TV side, over SSH, as root. Not part of the dev-machine build;
# scripts/register-service.ps1 ships it over and runs it.
#
# Usage: register-service.sh [--dry-run] [--unregister] [--system-wrapper]
#   --dry-run         print what would be written/removed, touch nothing
#   --unregister      remove the eleven files (rollback), then nudge the hub
#   --system-wrapper  Exec= the stock /usr/bin/run-js-service instead of the
#                     bundled thirdparty_jail=off wrapper (runs jailed)
set -e

DRY=0
UNREGISTER=0
SYSTEM_WRAPPER=0
for arg in "$@"; do
    case "$arg" in
        --dry-run)        DRY=1 ;;
        --unregister)     UNREGISTER=1 ;;
        --system-wrapper) SYSTEM_WRAPPER=1 ;;
        *) echo "unknown argument: $arg" >&2; exit 2 ;;
    esac
done

APP_ID=org.jazwinski.customwebos.home
SVC=$APP_ID.service
BASE=/var/luna-service2-dev
APP=/media/developer/apps/usr/palm/services/$SVC
APPINFO=/media/developer/apps/usr/palm/applications/$APP_ID/appinfo.json

SERVICE_FILE="$BASE/services.d/$SVC.service"
ROLE_FILE="$BASE/roles.d/$SVC.service.json"
API_FILE="$BASE/api-permissions.d/$SVC.api.json"
API_PUBLIC_FILE="$BASE/api-permissions.d/$SVC.api.public.json"
CLIENT_ROOT_FILE="$BASE/client-permissions.d/$SVC.root.json"
CLIENT_SERVICE_FILE="$BASE/client-permissions.d/$SVC.service.json"
APP_ROLE_FILE="$BASE/roles.d/$APP_ID.app.json"
APP_CLIENT_FILE="$BASE/client-permissions.d/$APP_ID.app.json"
DOORBELL_ID=org.jazwinski.customwebos.doorbell
DOORBELL_ROLE_FILE="$BASE/roles.d/$DOORBELL_ID.app.json"
DOORBELL_CLIENT_FILE="$BASE/client-permissions.d/$DOORBELL_ID.app.json"
MANIFEST_FILE="$BASE/manifests.d/$APP_ID.json"
ALL_FILES="$SERVICE_FILE $ROLE_FILE $API_FILE $API_PUBLIC_FILE $CLIENT_ROOT_FILE $CLIENT_SERVICE_FILE $APP_ROLE_FILE $APP_CLIENT_FILE $DOORBELL_ROLE_FILE $DOORBELL_CLIENT_FILE $MANIFEST_FILE"

nudge_hub() {
    if [ "$DRY" = 1 ]; then
        echo "would run: pkill -SIGHUP ls-hubd"
    else
        pkill -SIGHUP ls-hubd 2>/dev/null || true
    fi
}

# write PATH  — content on stdin
write() {
    if [ "$DRY" = 1 ]; then
        echo "would write $1:"
        cat
        echo
    else
        cat > "$1"
    fi
}

if [ "$UNREGISTER" = 1 ]; then
    for f in $ALL_FILES; do
        if [ "$DRY" = 1 ]; then echo "would remove $f"; else rm -f "$f"; fi
    done
    nudge_hub
    echo "unregistered $SVC (reboot to be sure the hub forgets it)"
    exit 0
fi

if [ "$DRY" = 0 ] && [ ! -d "$APP" ]; then
    echo "service bundle not found at $APP — install the .ipk first" >&2
    exit 1
fi

# The manifest version tracks the installed app, so it can't drift from
# appinfo.json between releases.
VERSION=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$APPINFO" 2>/dev/null | head -n 1)
[ -n "$VERSION" ] || VERSION=0.0.0

if [ "$SYSTEM_WRAPPER" = 1 ]; then
    EXEC="/usr/bin/run-js-service -n $APP"
else
    EXEC="$APP/run-js-service -n $APP"
fi

if [ "$DRY" = 0 ]; then
    mkdir -p "$BASE/services.d" "$BASE/roles.d" "$BASE/api-permissions.d" \
             "$BASE/client-permissions.d" "$BASE/manifests.d"
fi

write "$SERVICE_FILE" <<EOF
[D-BUS Service]
Name=$SVC
Exec=$EXEC
Type=dynamic
EOF

write "$ROLE_FILE" <<EOF
{"appId":"$SVC","type":"regular","allowedNames":["$SVC","*"],"permissions":[{"service":"$SVC","outbound":["*"]},{"service":"*","inbound":["*"],"outbound":["*"]}]}
EOF

write "$API_FILE" <<EOF
{"$SVC.group":["$SVC/*"]}
EOF

# Public: what any client may call. The doorbell methods stay out (any app on
# the TV could open the door); only the home and doorbell apps get them, via
# $SVC.group above.
write "$API_PUBLIC_FILE" <<EOF
{"public":["$SVC/listApps","$SVC/launch","$SVC/perfReport","$SVC/listPhotos","$SVC/showEnded"]}
EOF

write "$CLIENT_ROOT_FILE" <<EOF
{"$SVC*":["all"]}
EOF

write "$CLIENT_SERVICE_FILE" <<EOF
{"$SVC*":["public"]}
EOF

# A webapp connects to the bus as <appId>-<pid>, hence the trailing -*.
write "$APP_ROLE_FILE" <<EOF
{"appId":"$APP_ID","type":"regular","allowedNames":["$APP_ID-*"],"permissions":[{"service":"$APP_ID-*","outbound":["*"]}]}
EOF

write "$APP_CLIENT_FILE" <<EOF
{"$APP_ID-*":["public","$SVC.group"]}
EOF

# The doorbell box (doorbell/) reads its settings and opens the door through
# this service, so it gets the same two files.
write "$DOORBELL_ROLE_FILE" <<EOF
{"appId":"$DOORBELL_ID","type":"regular","allowedNames":["$DOORBELL_ID-*"],"permissions":[{"service":"$DOORBELL_ID-*","outbound":["*"]}]}
EOF

write "$DOORBELL_CLIENT_FILE" <<EOF
{"$DOORBELL_ID-*":["public","$SVC.group"]}
EOF

# The hub reads one manifest JSON per app from manifests.d/ which enumerates
# every file above. Without this, the individual services.d/ etc entries
# are not loaded.
write "$MANIFEST_FILE" <<EOF
{"id":"$APP_ID","version":"$VERSION","serviceFiles":["$SERVICE_FILE"],"roleFiles":["$ROLE_FILE","$APP_ROLE_FILE","$DOORBELL_ROLE_FILE"],"apiPermissionFiles":["$API_FILE","$API_PUBLIC_FILE"],"clientPermissionFiles":["$CLIENT_ROOT_FILE","$CLIENT_SERVICE_FILE","$APP_CLIENT_FILE","$DOORBELL_CLIENT_FILE"]}
EOF

nudge_hub

if [ "$DRY" = 1 ]; then
    echo "dry run: nothing written for $SVC"
else
    echo "manifests written for $SVC (version $VERSION)"
    # shellcheck disable=SC2086
    ls -la $ALL_FILES
fi
