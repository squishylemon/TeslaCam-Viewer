# Deploy bundle (minimal install)

Download **`teslacam-viewer-v*.zip`** from the repo’s **Releases** page (created automatically when you push a `v*` tag, e.g. `v1.0.0`).

Or zip these files from the repo root for end users:

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Pulls pre-built images |
| `config.env.example` | Copy to `config.env` |
| `setup.ps1` | Windows setup |
| `setup.sh` | Linux setup |

## One-time setup

1. Install [Docker](https://docs.docker.com/get-docker/) and Docker Compose.
2. Copy `config.env.example` to `config.env`.
3. Set `YOUR_GITHUB_USER` in the `TESLACAM_*_IMAGE` lines to whoever published the images (or your fork’s GHCR org).
4. Run:
   - **Windows:** `.\setup.ps1`
   - **Linux:** `chmod +x setup.sh && ./setup.sh`

5. Open `http://teslacam.local:4321` (or the IP URL printed by setup).

## Publish images (maintainers)

Push to `main` or tag `v*` — GitHub Actions publishes to:

`ghcr.io/<your-github-username>/teslacam-web:latest` (and `-sftp`, `-sftp-init`, `-host-mdns`, `-mdns`)

Make the packages **public** under GitHub → Packages → Package settings, or users need `docker login ghcr.io`.

## Develop from source

Clone the full repo and run:

```bash
./setup.sh --dev
# or
.\setup.ps1 -Dev
```
