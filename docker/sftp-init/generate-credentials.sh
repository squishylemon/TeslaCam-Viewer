#!/bin/sh
set -eu

CONFIG_DIR="${SFTP_CONFIG_DIR:-/config}"
CONFIG_FILE="$CONFIG_DIR/sftp.json"
USERNAME="${SFTP_USER:-teslacam}"

mkdir -p "$CONFIG_DIR"

if [ -f "$CONFIG_FILE" ]; then
  echo "SFTP credentials already exist at $CONFIG_FILE"
  exit 0
fi

PASSWORD=$(tr -dc 'A-HJ-NP-Za-km-z2-9' </dev/urandom | head -c 20)
PORT=$((20000 + $(od -An -N2 -tu2 /dev/urandom | tr -d ' ') % 40000))

# Host is filled when you open the viewer via your LAN IP (see Settings).
# Override with SFTP_PUBLIC_HOST if needed.
HOST="${SFTP_PUBLIC_HOST:-}"

CREATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

printf '{"host":"%s","port":%s,"username":"%s","password":"%s","createdAt":"%s"}\n' \
  "$HOST" "$PORT" "$USERNAME" "$PASSWORD" "$CREATED_AT" >"$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"

echo "Generated SFTP credentials: port=$PORT user=$USERNAME (host set on first web visit or SFTP_PUBLIC_HOST)"
