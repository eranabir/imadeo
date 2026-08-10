# Imadeo

**A private home for your photos and videos, on hardware you control.**

Imadeo backs up a phone's camera roll to your own server, then gives you one
place to browse the timeline, organise albums and folders, share selected
moments, search by what is in a photograph, and find people and duplicates.
Your originals stay on storage you choose.

## Development

`yarn dev` generates a local certificate and serves the full stack at
`https://localhost:5173`; the development API is also HTTPS on port `3001`.
For a phone, install and fully trust `.dev/certs/localhost.pem`, then use the
shown LAN address such as `https://192.168.0.130:5173`.

## Built for your library

- Automatic photo and video backup from iOS and Android.
- A timeline with albums, folders, places, people and favourites.
- Visual search, face grouping, duplicate detection and EXIF-aware dates.
- Private album and link sharing without handing over the whole library.
- Separate web and API containers, with one public port for both.

## Install

Imadeo is designed to run with Docker Compose. You need a server with Docker
and Docker Compose installed, plus enough disk space for your originals and
thumbnails.

```bash
git clone https://github.com/eranabir/imadeo.git
cd imadeo
cp .env.example .env
```

Open `.env` and set these values before starting:

```dotenv
# Generate with: openssl rand -hex 64
JWT_SECRET=replace-with-64-bytes-of-hex

# Generate with: openssl rand -hex 32
VAULT_MASTER_KEY=replace-with-32-bytes-of-hex

# Keep this on storage that is backed up and has room to grow.
UPLOAD_LOCATION=/path/to/your/imadeo-library
```

Then start Imadeo:

```bash
docker compose up -d --build
```

Set `IMADEO_DOMAIN` and `PUBLIC_URL` in `.env`, then open your HTTPS address
and create the first account. It becomes the administrator.

```bash
docker compose logs -f
docker compose down
```

## Connect the mobile app

Install Imadeo on your phone, enter your server’s address, and sign in with the
account you created. The app can back up your camera roll and show which items
are safely stored on the server.

Your phone must be able to reach the HTTPS address you enter. Do not expose the
service directly over HTTP: it would reveal account credentials and private media.

## HTTPS

The included Caddy proxy obtains and renews a Let's Encrypt certificate. Set an
A/AAAA record for your domain and forward TCP ports 80 and 443 to the host.

```dotenv
IMADEO_DOMAIN=photos.example.com
PUBLIC_URL=https://photos.example.com
```

Start Imadeo:

```bash
docker compose up -d --build
```

Connect the mobile app to `https://photos.example.com`.

## Configuration

`.env.example` documents every supported setting. The defaults are suitable for
a first installation; the most common adjustments are:

| Setting | What it controls |
| --- | --- |
| `UPLOAD_LOCATION` | Where originals, thumbnails and video previews are stored |
| `PUBLIC_URL` | The public HTTPS address used in invitations and sign-in callbacks |
| `TRASH_RETENTION_DAYS` | How long deleted items remain recoverable |
| `SMTP_*` | Email invitations; optional, with share links as the fallback |
| `GOOGLE_*` / `APPLE_*` | Optional social sign-in |
| `ML_*` | Visual-search and face-recognition worker behaviour |

Back up `UPLOAD_LOCATION` and the PostgreSQL data directory. They are the two
parts of an installation that cannot be recreated from the container image.

## Updates

Pull the latest code and rebuild the stack:

```bash
git pull
docker compose up -d --build
```

Imadeo releases the web, server, and machine-learning images from version
tags. Docker Compose updates the whole stack together.

## Project

The public site and product guide are at [imadeo.app](https://imadeo.app).
Issues and feature requests belong in this repository.
