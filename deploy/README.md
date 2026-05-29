# Deploy Bundle Guide

This folder documents the minimal bundle for end users.

## What the release zip contains

The release zip is built by `.github/workflows/release.yml` and includes only:

- `docker-compose.yml`
- `config.env.example`
- `setup.ps1`
- `setup.sh`
- `install.ps1`
- `install.sh`
- `README.md` (copied from this file)

## Requirements

- Docker Desktop on Windows, or Docker Engine plus Docker Compose on Linux
- Internet access to pull container images from GHCR
- Ports `4321` and `5432` available locally (defaults)

## Fast install from latest release

Replace `squishylemon/TeslaCam-Viewer` if you are using a fork.

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/squishylemon/TeslaCam-Viewer/main/install.ps1 | iex
```

Linux (`curl`, `jq`, `unzip` required):

```bash
curl -fsSL https://raw.githubusercontent.com/squishylemon/TeslaCam-Viewer/main/install.sh | bash
```

These scripts list releases (not `/releases/latest`) so prerelease zips from `main` still work.

If you already have this folder extracted, run `.\setup.ps1` or `./setup.sh` directly.

## Manual install

1. Download `teslacam-viewer-*.zip` from Releases.
2. Extract the zip.
3. Run setup:
   - Windows: `.\setup.ps1`
   - Linux: `chmod +x setup.sh && ./setup.sh`
4. Open:
   - `http://teslacam.local:4321`
   - or `http://<LAN_IP>:4321`

The setup scripts detect LAN IP, write `config.env`, pull images, and start services.

## First login and upload flow

1. Sign in with default credentials: `admin` / `admin`.
2. Open Settings and configure security:
   - passkey
   - TOTP
   - password update
3. In Settings, copy SFTP host, port, username, and password.
4. Upload TeslaCam folders through SFTP to `/upload`.
5. Refresh the viewer and select your vehicle folder if prompted.

## mDNS troubleshooting (Linux)

If `teslacam.local` does not resolve:

```bash
sudo apt install avahi-utils
./setup.sh
./scripts/linux-host-mdns.sh status
```

Use `http://<LAN_IP>:4321` if mDNS is blocked on your network. Add `MDNS_MODE=host` to `config.env` to force host Avahi publishing.

## Maintainer notes

- Docker image publishing: `.github/workflows/docker-publish.yml`
- Release zip publishing: `.github/workflows/release.yml`
- Keep GHCR packages public unless you require users to authenticate with `docker login ghcr.io`
