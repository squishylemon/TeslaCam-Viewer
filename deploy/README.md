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

## `permission denied` when pulling images (GHCR)

This usually means Docker cannot download `ghcr.io/.../teslacam-*` images.

### 1. Check image names in `config.env`

They must match the GitHub user or org that published the images:

```env
TESLACAM_WEB_IMAGE=ghcr.io/squishylemon/teslacam-web:latest
```

Replace `squishylemon` if you use a fork. Do not leave `YOUR_GITHUB_USER` in place.

Test one image:

```bash
docker pull ghcr.io/squishylemon/teslacam-web:latest
```

### 2. Make GHCR packages public (maintainer)

For each package (`teslacam-web`, `teslacam-sftp`, `teslacam-sftp-init`, `teslacam-host-mdns`, `teslacam-mdns`):

1. Open https://github.com/users/squishylemon/packages
2. Open the package
3. **Package settings** -> change visibility to **Public**

Then pull again:

```bash
cp config.env .env   # setup.sh does this automatically
docker compose pull
```

### 3. Or log in (private packages)

```bash
echo YOUR_GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

Create a classic PAT with `read:packages` at https://github.com/settings/tokens

### 4. Build locally (no GHCR pull)

```bash
./setup.sh --dev
```
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

## Docker Compose env (no `--env-file` needed)

`setup.sh` / `setup.ps1` copy `config.env` to `.env`. Compose loads `.env` automatically.

If you edit `config.env` by hand:

```bash
cp config.env .env
docker compose up -d
```

## SFTP upload `Permission denied`

After updating, recreate the SFTP container (or pull the latest `teslacam-sftp` image):

```bash
docker compose up -d --force-recreate sftp
```

The entrypoint fixes ownership on `/home/teslacam/upload` (volumes are often root-owned).

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
