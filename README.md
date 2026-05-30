# TeslaCam Viewer

TeslaCam Viewer is a self hosted web app for browsing Tesla dashcam clips and playing the four camera views in sync.

## Features

- TeslaCam clip browsing and timeline playback
- Four camera synchronized player (`front`, `back`, `left_repeater`, `right_repeater`)
- SFTP upload workflow
- Multi vehicle folder support (`MX_Name`, `MY_Name`, `MS_Name`, `M3_Name`)
- Authentication with password, passkey, and TOTP
- LAN friendly hostname publishing with `teslacam.local`

## Requirements

- Docker Desktop (Windows) or Docker Engine plus Docker Compose (Linux)
- Local network access for browser and SFTP clients
- Available ports: `4321` for web and `5432` for Postgres by default

## Quick install from Releases

Use the install scripts. They download the newest release zip, including prereleases (main branch auto releases are prereleases, so `/releases/latest` often returns 404).

Replace `squishylemon/TeslaCam-Viewer` if you use a fork.

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/squishylemon/TeslaCam-Viewer/main/install.ps1 | iex
```

Linux (needs `curl`, `jq`, `unzip`):

```bash
curl -fsSL https://raw.githubusercontent.com/squishylemon/TeslaCam-Viewer/main/install.sh | bash
```

If you already downloaded a release zip, extract it and run `.\setup.ps1` or `./setup.sh`.

## Manual install from source bundle

1. Ensure `config.env.example`, `docker-compose.yml`, `setup.ps1`, and `setup.sh` are present.
2. Run setup:
   - Windows: `.\setup.ps1`
   - Linux: `chmod +x setup.sh && ./setup.sh`
3. Open the viewer:
   - `http://teslacam.local:4321`
   - or `http://<LAN_IP>:4321`

Setup automatically detects a LAN IP, writes `config.env`, pulls images, and starts containers.

## Default credentials and first run

- Username: `admin`
- Password: `admin`

After first login:

1. Open Settings.
2. Change password.
3. Configure passkey and or TOTP.
4. Copy SFTP details for uploading clips.

## Upload clips

Upload via SFTP to `/upload`. Example layout:

```text
/upload/
  MX_Family/
    SavedClips/
      2025-12-10_18-55-03/
    SentryClips/
  MY_Daily/
    SavedClips/
    SentryClips/
```

Legacy single vehicle layout is also supported:

```text
/upload/SavedClips
/upload/SentryClips
```

SFTP CLI example:

```bash
sftp -P PORT teslacam@SERVER_IP
put -r MX_MyCar
```

## HTTPS and `ERR_SSL_PROTOCOL_ERROR`

`ERR_SSL_PROTOCOL_ERROR` means the browser used **https** but the server is speaking **plain HTTP**.

| `USE_HTTPS` in config.env | Open this URL |
| --- | --- |
| `false` (default) | `http://teslacam.local:4321` or `http://<LAN_IP>:4321` |
| `true` | `https://teslacam.local:4321` or `https://<LAN_IP>:4321` |

After changing `USE_HTTPS`, recreate the web container:

```bash
cp config.env .env   # if you edited config.env by hand
docker compose up -d --force-recreate web
docker logs teslacam-viewer | tail -n 20
```

You should see `[start] USE_HTTPS=true — starting with TLS` or `... plain HTTP`. Accept the self-signed certificate warning once when using HTTPS.

Do not mix schemes: `https://` against an HTTP server causes this error. A hosts file line only maps the name; it does not enable TLS.

## Core runtime behavior

- Web UI is HTTP by default; set `USE_HTTPS=true` to enable HTTPS mode (required for passkeys)
- `host-mdns` advertises `teslacam.local` on the LAN
- SFTP credentials and port are shown in Settings after login
- Uploaded clips are read only by the viewer and are not modified

## mDNS (`teslacam.local`) on Linux

`teslacam.local` is not automatic discovery like a smart TV. Devices must resolve it via mDNS or a hosts file entry.

On Linux, `./setup.sh` tries host Avahi first (`MDNS_MODE=auto`):

```bash
sudo apt install avahi-utils
./setup.sh
```

If `teslacam.local` still fails:

1. Confirm `LAN_IP` in `config.env` is your real LAN address (not `docker0` or `172.17.x.x`).
2. Check port 5353 is free: `ss -ulnp | grep 5353`
3. If `systemd-resolved` owns mDNS, set `MDNS_MODE=host` and rerun setup, or add a hosts entry on each client:
   `192.168.x.x teslacam.local`
4. Allow UDP 5353 in firewall (`ufw allow 5353/udp`).
5. Restart host publishing: `./scripts/linux-host-mdns.sh restart`

The direct IP URL from setup always works: `http://<LAN_IP>:4321`.

## Configuration

Generated `config.env` keys:

- `LAN_IP`
- `SITE_HOSTNAME` (default `teslacam.local`)
- `WEB_PORT` (default `4321`)
- `USE_HTTPS` (`false` by default)
- `MDNS_MODE` (`auto`, `host`, `container`, `off`)
- `SESSION_SECRET`
- `DEBUG` (`true` for local testing only: skips passkey/TOTP and shows a fixed warning footer)
- `TESLACAM_*_IMAGE` image references

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space / K | Play or pause |
| J / Left Arrow | Back 10 seconds |
| L / Right Arrow | Forward 10 seconds |
| P | Previous segment |
| N | Next segment |
| M | Mute or unmute |
| F | Fullscreen |

## Development

Build and run from source with local builds:

```powershell
.\setup.ps1 -Dev
```

```bash
./setup.sh --dev
```

This uses `docker-compose.dev.yml`.

## Publishing and releases

- Docker image publishing workflow: `.github/workflows/docker-publish.yml`
- Release zip workflow: `.github/workflows/release.yml`
- Release zip docs: `deploy/README.md`

For public user installs, make GHCR packages public in GitHub Packages settings.

If `docker compose pull` fails with **permission denied**, the images are private or `config.env` points at the wrong GHCR path. See `deploy/README.md` (section on GHCR pull errors).

