#!/bin/sh
set -eu

CONFIG_FILE="${SFTP_CONFIG_DIR:-/config}/sftp.json"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "Missing $CONFIG_FILE — run sftp-init first." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required in the SFTP image." >&2
  exit 1
fi

PORT=$(jq -r '.port' "$CONFIG_FILE")
PASS=$(jq -r '.password' "$CONFIG_FILE")
USER=$(jq -r '.username' "$CONFIG_FILE")

if [ -z "$PORT" ] || [ -z "$PASS" ] || [ -z "$USER" ]; then
  echo "Invalid SFTP credentials file." >&2
  exit 1
fi

UPLOAD="/home/$USER/upload"
UID_NUM=1001
GID_NUM=1001

mkdir -p "$UPLOAD"
# Chroot parent must be root-owned; upload dir must be writable by the SFTP user.
# Named volumes are often created as root — fix ownership on every start.
chown root:root "/home/$USER"
chmod 755 "/home/$USER"
chown -R "$UID_NUM:$GID_NUM" "$UPLOAD"
chmod 775 "$UPLOAD"

if grep -q '^Port ' /etc/ssh/sshd_config 2>/dev/null; then
  sed -i "s/^Port .*/Port $PORT/" /etc/ssh/sshd_config
else
  echo "Port $PORT" >>/etc/ssh/sshd_config
fi

echo "Starting SFTP on port $PORT (chroot upload) for user $USER"
exec /entrypoint "$USER:$PASS:1001:1001:upload"
