# TeslaCam Viewer



A self-hosted web app (Astro + Node SSR) that browses **TeslaCam** dashcam footage

and plays each event's four cameras in a synced grid as one continuous timeline.



- Clips are **uploaded to the server over SFTP** (no path picker in the UI).

- Scans `SavedClips` and `SentryClips` (RecentClips is ignored).

- **Multi-vehicle** layouts: `MX_Name`, `MY_Name`, `MS_Name`, `M3_Name` folders.

- Full player controls, HTTP Range streaming, auth (passkey / TOTP).



## Expected folder layout



Upload into the server's TeslaCam folder (SFTP remote path `/upload`):



```

/upload/

  MX_Family/

    SavedClips/

      2025-12-10_18-55-03/

        ...

    SentryClips/

      ...

  MY_Daily/

    SavedClips/

    SentryClips/

```



Legacy single-car layout also works (`SavedClips` / `SentryClips` directly under `/upload`).



## Run with Docker (recommended)

**End users (pre-built images):** only need `docker-compose.yml`, `config.env`, and `setup.ps1` / `setup.sh`.

```powershell
copy config.env.example config.env
# Edit YOUR_GITHUB_USER in the TESLACAM_*_IMAGE lines (who published the images)
.\setup.ps1
```

```bash
cp config.env.example config.env
./setup.sh
```

Setup detects your LAN IP, pulls images from GHCR, and starts the stack. Open `http://teslacam.local:4321` (or the IP URL it prints).

- **Viewer:** port `4321` (HTTP by default; set `USE_HTTPS=true` for passkeys)
- **SFTP:** random port + password (see Settings after login)
- **mDNS:** `host-mdns` container advertises `teslacam.local` on the LAN

Default login: `admin` / `admin`

### Publish images (maintainers)

GitHub Actions (`.github/workflows/docker-publish.yml`) builds and pushes to:

`ghcr.io/<your-github-username>/teslacam-web:latest` (+ `teslacam-sftp`, `teslacam-sftp-init`, `teslacam-host-mdns`, `teslacam-mdns`)

After the first workflow run, set each package to **Public** on github.com → Packages.

### Develop from source

```bash
./setup.sh --dev
```

```powershell
.\setup.ps1 -Dev
```

This builds locally using `docker-compose.dev.yml` instead of pulling images.

## Upload footage

1. In Settings, use **Connect with SFTP app** (or copy host, port, user, password).
2. Upload your TeslaCam folders — you land directly in the upload area (chroot).
3. Refresh the viewer and pick a vehicle if needed.

Example CLI (use values from Settings):

```bash
sftp -P PORT teslacam@SERVER_IP
put -r MX_MyCar
```



## Run locally (without Docker)



Requires Node 20+ and PostgreSQL:



```bash

docker compose up -d db sftp

cp .env.example .env

npm install

npm run dev

```



Clips are read from `TESLACAM_DIR` (default `./data/TeslaCam`). The SFTP container writes to the same `teslacam` Docker volume when you use compose; for pure local dev, copy files into `data/TeslaCam` or point `TESLACAM_DIR` at your folder.



## Keyboard shortcuts



| Key            | Action                  |

| -------------- | ----------------------- |

| Space / K      | Play / Pause            |

| J / Left arrow | Back 10s                |

| L / Right arrow| Forward 10s             |

| P              | Previous segment        |

| N              | Next segment            |

| M              | Mute / Unmute           |

| F              | Fullscreen              |



## Notes



- Cameras: `front`, `back`, `left_repeater`, `right_repeater`.

- The viewer does not modify uploaded files.

