# Imadeo

**A private home for your photos and videos, on hardware you control.**

Imadeo backs up a phone's camera roll to your own server, then gives you one
place to browse the timeline, organise albums and folders, share selected
moments, search by what is in a photograph, and find people and duplicates.
Your originals stay on storage you choose.

## Built for your library

- Automatic photo and video backup from iOS and Android.
- A timeline with albums, folders, places, people and favourites.
- Visual search, face grouping, duplicate detection and EXIF-aware dates.
- Private album and link sharing without handing over the whole library.
- One server container for the browser app and API.

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

Open `http://your-server:3001` and create the first account. It becomes the
administrator. The server applies database migrations automatically on startup.

```bash
docker compose logs -f
docker compose down
```

## Connect the mobile app

Install Imadeo on your phone, enter your server’s address, and sign in with the
account you created. The app can back up your camera roll and show which items
are safely stored on the server.

Your phone must be able to reach the address you enter. For access away from
home, put Imadeo behind HTTPS with a reverse proxy and use a domain name.

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

Imadeo releases server and machine-learning images from version tags. The web
app ships inside the server image, so there is only one application service to
update.

## Project

The public site and product guide are at [imadeo.app](https://imadeo.app).
Issues and feature requests belong in this repository.
