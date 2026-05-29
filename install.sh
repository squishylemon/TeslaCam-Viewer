#!/usr/bin/env bash
# Download the newest release zip (including prereleases) and run setup.
set -euo pipefail

REPO="${TESLACAM_REPO:-squishylemon/TeslaCam-Viewer}"
WORKDIR="${TESLACAM_DIR:-teslacam-release}"
ZIP="${TESLACAM_ZIP:-teslacam.zip}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required." >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required (install with your package manager)." >&2
  exit 1
fi
if ! command -v unzip >/dev/null 2>&1; then
  echo "unzip is required." >&2
  exit 1
fi

api="https://api.github.com/repos/${REPO}/releases?per_page=30"
json="$(curl -fsSL \
  -H 'User-Agent: teslacam-installer' \
  -H 'Accept: application/vnd.github+json' \
  "$api")" || {
  echo "Could not fetch releases for ${REPO}." >&2
  exit 1
}

url="$(echo "$json" | jq -r '
  [.[] | .assets[]? | select(.name | test("^teslacam-viewer-.*\\.zip$")) | .browser_download_url][0] // empty
')"

if [ -z "$url" ]; then
  echo "No teslacam-viewer-*.zip asset found for ${REPO}." >&2
  echo "Open https://github.com/${REPO}/releases and publish a release with the deploy zip." >&2
  exit 1
fi

echo "Downloading release zip..."
curl -fL "$url" -o "$ZIP"

rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"
unzip -oq "$ZIP" -d "$WORKDIR"

if [ ! -f "$WORKDIR/setup.sh" ]; then
  echo "Zip is missing setup.sh." >&2
  exit 1
fi

chmod +x "$WORKDIR/setup.sh"
cd "$WORKDIR"
exec ./setup.sh "$@"
