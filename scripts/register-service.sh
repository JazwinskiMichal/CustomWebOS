#!/bin/sh
# Register the CustomWebOS home service with the luna-service2 hub on the TV.
# Writes the six manifest files Hbchannel-style, then triggers a hub reload.
# Idempotent — safe to re-run.
#
# Runs on the TV side, over SSH, as root. Not part of the dev-machine build.
set -e

SVC=org.jazwinski.customwebos.home.service
BASE=/var/luna-service2-dev
APP=/media/developer/apps/usr/palm/services/$SVC

if [ ! -d "$APP" ]; then
    echo "service bundle not found at $APP — install the .ipk first" >&2
    exit 1
fi

mkdir -p "$BASE/services.d" "$BASE/roles.d" "$BASE/api-permissions.d" "$BASE/client-permissions.d"

cat > "$BASE/services.d/$SVC.service" <<EOF
[D-BUS Service]
Name=$SVC
Exec=$APP/run-js-service -n $APP
Type=dynamic
EOF

cat > "$BASE/roles.d/$SVC.service.json" <<EOF
{"appId":"$SVC","type":"regular","allowedNames":["$SVC","*"],"permissions":[{"service":"$SVC","outbound":["*"]},{"service":"*","inbound":["*"],"outbound":["*"]}]}
EOF

cat > "$BASE/api-permissions.d/$SVC.api.json" <<EOF
{"$SVC.group":["$SVC/*"]}
EOF

cat > "$BASE/api-permissions.d/$SVC.api.public.json" <<EOF
{"public":["$SVC/*"]}
EOF

cat > "$BASE/client-permissions.d/$SVC.root.json" <<EOF
{"$SVC*":["all"]}
EOF

cat > "$BASE/client-permissions.d/$SVC.service.json" <<EOF
{"$SVC*":["public"]}
EOF

# The hub reads one manifest JSON per app from manifests.d/ which enumerates
# every file above. Without this, the individual services.d/ etc entries
# are not loaded.
mkdir -p "$BASE/manifests.d"
cat > "$BASE/manifests.d/org.jazwinski.customwebos.home.json" <<EOF
{"id":"org.jazwinski.customwebos.home","version":"0.2.0","serviceFiles":["$BASE/services.d/$SVC.service"],"roleFiles":["$BASE/roles.d/$SVC.service.json"],"apiPermissionFiles":["$BASE/api-permissions.d/$SVC.api.json","$BASE/api-permissions.d/$SVC.api.public.json"],"clientPermissionFiles":["$BASE/client-permissions.d/$SVC.root.json","$BASE/client-permissions.d/$SVC.service.json"]}
EOF

# Nudge the hub so it rereads the manifests directory.
pkill -SIGHUP ls-hubd 2>/dev/null || true

echo "manifests written for $SVC"
ls -la "$BASE/services.d/$SVC.service" \
       "$BASE/roles.d/$SVC.service.json" \
       "$BASE/api-permissions.d/$SVC.api.json" \
       "$BASE/api-permissions.d/$SVC.api.public.json" \
       "$BASE/client-permissions.d/$SVC.root.json" \
       "$BASE/client-permissions.d/$SVC.service.json"
