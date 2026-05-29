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



```bash

docker compose up --build

```



- **Viewer:** <http://localhost:4321>
- **SFTP:** server LAN IP, random port, 20-character password (generated on first boot)

Sign in as `admin` / `admin`, complete security setup, then open **Settings → Upload clips (SFTP)** for connection details and **Connect with SFTP app**.

### Production environment

```bash
SESSION_SECRET=...
WEBAUTHN_RP_ID=your.server.example
WEBAUTHN_ORIGIN=https://your.server.example
```

Open the SFTP port shown in Settings in your firewall. Credentials are stored in the Docker `sftpconfig` volume and stay the same across restarts.

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

