#!/usr/bin/env bash
# Auto-detect LAN IP, write config.env, pull images, start stack.
set -euo pipefail

DEV=0
[[ "${1:-}" == "--dev" ]] && DEV=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

CONFIG="$ROOT/config.env"
EXAMPLE="$ROOT/config.env.example"

is_lan_ip() {
  local ip="$1"
  [[ -z "$ip" ]] && return 1
  [[ "$ip" =~ ^127\. ]] && return 1
  [[ "$ip" =~ ^169\.254\. ]] && return 1
  [[ "$ip" =~ ^192\.168\.65\. ]] && return 1
  [[ "$ip" =~ ^172\.(17|18)\. ]] && return 1
  [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
  return 0
}

rank_ip() {
  case "$1" in
    192.168.[0-9]*.[0-9]*) echo 100 ;;
    10.*) echo 80 ;;
    172.1[6-9].*|172.2[0-9].*|172.3[0-1].*) echo 60 ;;
    *) echo 10 ;;
  esac
}

is_docker_iface() {
  case "$1" in
    docker*|br-*|veth*|virbr*|podman*) return 0 ;;
  esac
  return 1
}

detect_lan_ip() {
  local ip ifname candidates=() r best_ip="" best_rank=0
  if command -v ip >/dev/null 2>&1; then
    ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") print $(i+1)}')"
    is_lan_ip "$ip" && candidates+=("$ip")
    while read -r ifname ip; do
      is_docker_iface "$ifname" && continue
      is_lan_ip "$ip" && candidates+=("$ip")
    done < <(ip -4 -o addr show scope global 2>/dev/null | awk '{print $2, $4}' | sed 's|/.*||')
  fi
  for ip in $(printf '%s\n' "${candidates[@]}" | sort -u); do
    r=$(rank_ip "$ip")
    if [ "$r" -gt "$best_rank" ]; then
      best_rank=$r
      best_ip=$ip
    fi
  done
  echo "$best_ip"
}

new_session_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
  else
    head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 48
  fi
}

update_config_env() {
  local lan_ip="$1"
  local tmp has_lan=0 has_secret=0 has_https=0
  [ -f "$EXAMPLE" ] || { echo "config.env.example missing" >&2; exit 1; }
  [ -f "$CONFIG" ] || cp "$EXAMPLE" "$CONFIG"
  tmp="$(mktemp)"
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" =~ ^[[:space:]]*LAN_IP[[:space:]]*= ]]; then
      echo "LAN_IP=$lan_ip"
      has_lan=1
    elif [[ "$line" =~ ^[[:space:]]*SESSION_SECRET[[:space:]]*= ]]; then
      secret="${line#*=}"
      secret="$(echo "$secret" | tr -d '[:space:]')"
      if [ -z "$secret" ] || [ "$secret" = 'change-me-use-a-long-random-string' ]; then
        echo "SESSION_SECRET=$(new_session_secret)"
      else
        echo "$line"
      fi
      has_secret=1
    else
      [[ "$line" =~ ^[[:space:]]*USE_HTTPS[[:space:]]*= ]] && has_https=1
      echo "$line"
    fi
  done < "$CONFIG" > "$tmp"
  [ "$has_lan" -eq 1 ] || echo "LAN_IP=$lan_ip" >> "$tmp"
  [ "$has_secret" -eq 1 ] || echo "SESSION_SECRET=$(new_session_secret)" >> "$tmp"
  [ "$has_https" -eq 1 ] || echo "USE_HTTPS=false" >> "$tmp"
  mv "$tmp" "$CONFIG"
}

compose() {
  docker compose --env-file "$CONFIG" "$@"
}

LAN_IP="$(detect_lan_ip)"
[ -n "$LAN_IP" ] || { echo "Could not detect LAN IP" >&2; exit 1; }

echo "Using LAN_IP=$LAN_IP"
update_config_env "$LAN_IP"

if [ "$DEV" -eq 1 ]; then
  echo "Dev mode: building locally..."
  compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
else
  echo "Pulling images..."
  compose pull
  echo "Starting stack..."
  compose up -d
fi

PORT=4321
if grep -qE '^[[:space:]]*WEB_PORT[[:space:]]*=' "$CONFIG"; then
  PORT=$(grep -E '^[[:space:]]*WEB_PORT[[:space:]]*=' "$CONFIG" | head -n1 | cut -d= -f2 | tr -d '[:space:]')
fi
PROTO=http
grep -qE '^[[:space:]]*USE_HTTPS[[:space:]]*=[[:space:]]*true' "$CONFIG" && PROTO=https

configure_linux_mdns() {
  [ "$(uname -s)" = "Linux" ] || return 0

  local mode
  mode="$(grep -E '^[[:space:]]*MDNS_MODE[[:space:]]*=' "$CONFIG" 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '[:space:]')"
  mode="${mode:-auto}"

  if [ "$mode" = "off" ]; then
    compose stop host-mdns >/dev/null 2>&1 || true
    bash "$ROOT/scripts/linux-host-mdns.sh" stop >/dev/null 2>&1 || true
    echo "[mdns] Disabled (MDNS_MODE=off)"
    return 0
  fi

  if [ "$mode" = "host" ] || { [ "$mode" = "auto" ] && command -v avahi-publish >/dev/null 2>&1; }; then
    compose stop host-mdns >/dev/null 2>&1 || true
    if bash "$ROOT/scripts/linux-host-mdns.sh" start; then
      echo "[mdns] Using host Avahi (recommended on Linux)"
      return 0
    fi
    echo "[mdns] Host Avahi failed, falling back to container host-mdns"
    compose up -d host-mdns
    return 0
  fi

  echo "[mdns] Using container host-mdns"
  echo "[mdns] If teslacam.local does not resolve, install avahi-utils and rerun setup"
}

configure_linux_mdns

HOSTNAME=teslacam.local
if grep -qE '^[[:space:]]*SITE_HOSTNAME[[:space:]]*=' "$CONFIG"; then
  HOSTNAME=$(grep -E '^[[:space:]]*SITE_HOSTNAME[[:space:]]*=' "$CONFIG" | head -n1 | cut -d= -f2- | tr -d '[:space:]')
fi

echo ""
echo "=== Open the site ==="
echo "  ${PROTO}://${HOSTNAME}:${PORT}"
echo "  ${PROTO}://${LAN_IP}:${PORT}"
echo ""
echo "If ${HOSTNAME} does not resolve, add this line to /etc/hosts on the client device:"
echo "  ${LAN_IP} ${HOSTNAME}"
echo ""
echo "Developers: ./setup.sh --dev"
