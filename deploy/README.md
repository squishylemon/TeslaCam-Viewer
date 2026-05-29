# Deploy Bundle Guide

This folder documents the minimal bundle for end users.

## What the release zip contains

The release zip is built by `.github/workflows/release.yml` and includes only:

- `docker-compose.yml`
- `config.env.example`
- `setup.ps1`
- `setup.sh`
- `README.md` (copied from this file)

## Requirements

- Docker Desktop on Windows, or Docker Engine plus Docker Compose on Linux
- Internet access to pull container images from GHCR
- Ports `4321` and `5432` available locally (defaults)

## Fast install from latest release

Replace `squishylemon/TeslaCam-Viewer` if you are using a fork.

Windows PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "$repo='squishylemon/TeslaCam-Viewer'; $api='https://api.github.com/repos/'+$repo+'/releases/latest'; $asset=(Invoke-RestMethod -Headers @{ 'User-Agent'='teslacam-installer' } $api).assets | Where-Object { $_.name -like 'teslacam-viewer-*.zip' } | Select-Object -First 1; Invoke-WebRequest -Headers @{ 'User-Agent'='teslacam-installer' } -Uri $asset.browser_download_url -OutFile teslacam.zip; Remove-Item -Recurse -Force teslacam-release -ErrorAction SilentlyContinue; Expand-Archive -Path teslacam.zip -DestinationPath teslacam-release -Force; Set-Location teslacam-release; .\setup.ps1"
```

Linux:

```bash
repo='squishylemon/TeslaCam-Viewer'; url="$(curl -fsSL -H 'User-Agent: teslacam-installer' "https://api.github.com/repos/$repo/releases/latest" | jq -r '.assets[] | select(.name|test("^teslacam-viewer-.*\\.zip$")) | .browser_download_url' | head -n1)"; curl -fL "$url" -o teslacam.zip && rm -rf teslacam-release && mkdir -p teslacam-release && unzip -oq teslacam.zip -d teslacam-release && cd teslacam-release && chmod +x setup.sh && ./setup.sh
```

Note for Linux one-liner: it expects `curl`, `jq`, and `unzip`.

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

## Maintainer notes

- Docker image publishing: `.github/workflows/docker-publish.yml`
- Release zip publishing: `.github/workflows/release.yml`
- Keep GHCR packages public unless you require users to authenticate with `docker login ghcr.io`
