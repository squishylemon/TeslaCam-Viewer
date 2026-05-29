#!/usr/bin/env bash
# Publish teslacam.local using the host Avahi stack (recommended on Linux).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${TESLACAM_CONFIG:-$ROOT/config.env}"
PID_A="$ROOT/.teslacam-avahi-a.pid"
PID_S="$ROOT/.teslacam-avahi-s.pid"

cfg() {
  local key="$1" default="${2:-}"
  local line
  line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$CONFIG" 2>/dev/null | head -n1 || true)"
  if [ -z "$line" ]; then
    echo "$default"
    return
  fi
  echo "${line#*=}" | tr -d '[:space:]'
}

stop_publishers() {
  for f in "$PID_A" "$PID_S"; do
    if [ -f "$f" ]; then
      kill "$(cat "$f")" 2>/dev/null || true
      rm -f "$f"
    fi
  done
}

start_publishers() {
  if ! command -v avahi-publish >/dev/null 2>&1; then
    echo "[mdns] avahi-publish not found. Install: sudo apt install avahi-utils" >&2
    return 1
  fi

  local host ip port https proto
  host="$(cfg SITE_HOSTNAME teslacam.local)"
  ip="$(cfg LAN_IP)"
  port="$(cfg WEB_PORT 4321)"
  https="$(cfg USE_HTTPS false)"

  if [ -z "$ip" ]; then
    echo "[mdns] LAN_IP is empty in config.env" >&2
    return 1
  fi

  stop_publishers

  avahi-publish -a -R "$host" "$ip" >/dev/null 2>&1 &
  echo $! >"$PID_A"

  local service_type
  if [ "$https" = "true" ] || [ "$https" = "1" ]; then
    service_type=_https._tcp
    proto=https
  else
    service_type=_http._tcp
    proto=http
  fi

  avahi-publish -s -R "TeslaCam Viewer" "$service_type" "$port" "path=/" >/dev/null 2>&1 &
  echo $! >"$PID_S"

  echo "[mdns] Host Avahi publishing ${host} -> ${ip} (${proto} port ${port})"
}

status_publishers() {
  if [ -f "$PID_A" ] && kill -0 "$(cat "$PID_A")" 2>/dev/null; then
    echo "[mdns] A record publisher running (pid $(cat "$PID_A"))"
  else
    echo "[mdns] A record publisher not running"
  fi
}

case "${1:-start}" in
  start) start_publishers ;;
  stop) stop_publishers ;;
  restart) stop_publishers; start_publishers ;;
  status) status_publishers ;;
  *)
    echo "Usage: $0 {start|stop|restart|status}" >&2
    exit 1
    ;;
esac
