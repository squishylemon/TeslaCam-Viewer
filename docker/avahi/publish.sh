#!/bin/sh
HOST_FQDN="${SITE_HOSTNAME:-teslacam.local}"
WEB_PORT="${WEB_PORT:-4321}"
LAN_IP="${LAN_IP:-}"

log() { echo "[mdns] $*" >&2; }

if [ -z "$LAN_IP" ]; then
  log "LAN_IP not set — add it to config.env, then: docker compose up -d"
  exec sleep infinity
fi

log "Advertising ${HOST_FQDN} -> ${LAN_IP} (port ${WEB_PORT})"

rm -f /run/avahi-daemon/pid 2>/dev/null || true
mkdir -p /run/avahi-daemon /var/run/dbus
dbus-daemon --system --fork 2>/dev/null || true
sleep 1
avahi-daemon -D 2>/dev/null || true
sleep 2

avahi-publish -a -R "$HOST_FQDN" "$LAN_IP" &
avahi-publish -s -R "TeslaCam Viewer" _https._tcp "$WEB_PORT" \
  "path=/ u=https://${HOST_FQDN}:${WEB_PORT}/" &

log "Ready — https://${HOST_FQDN}:${WEB_PORT}/ (after hosts file on each device)"

wait
