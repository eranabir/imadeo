# Imadeo

**A private home for your photos and videos, on hardware you control.**

Imadeo backs up a phone's camera roll to your own server, then gives you one
place to browse the timeline, organise albums and folders, share selected
moments, search by what is in a photograph, and find people, pets and duplicates.
Your originals stay on storage you choose.

## Development

`yarn dev` serves the full local stack at `http://localhost:5173`; the
API is on HTTP port `6666` in development and production. Production web is
served on port `1111`. Remote deployments should use an
HTTPS reverse proxy for remote access.

## Built for your library

- Automatic photo and video backup from iOS and Android.
- A timeline with albums, folders, places, people and pets, and favourites.
- Local visual search, people and pet grouping (cats and dogs), duplicate detection and EXIF-aware dates.
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
./scripts/generate-secrets.sh
```

The generator fills the database, Redis, JWT and Locked-folder secrets without
overwriting existing values. Open `.env` and set the storage paths before starting:

```dotenv
# Permanent data root, kept outside the cloned repository.
UPLOAD_LOCATION=/path/to/your/imadeo-data
DB_DATA_LOCATION=/path/to/your/imadeo-postgres
```

Then start Imadeo:

```bash
docker compose pull
docker compose up -d
```

On your LAN or VPN, open `http://<server-ip>:1111` and create the first account.
The mobile app connects to `http://<server-ip>:6666`.

```bash
docker compose logs -f
docker compose down
```

## Connect the mobile app

Install Imadeo on your phone, enter your server’s address, and sign in with the
account you created. The app can back up your camera roll and show which items
are safely stored on the server.

On a LAN or VPN, enter the server IP and port `6666`; Imadeo selects HTTP for
private addresses. For internet access, enter the HTTPS address of your reverse
proxy instead.

## Remote access with a reverse proxy

Imadeo does not ship a public proxy. Keep ports `1111` and `6666` private, then
point a reverse proxy at the web port. It terminates HTTPS and forwards the
original `Host`, `X-Real-IP`, `X-Forwarded-For`, and `X-Forwarded-Proto` headers.
Allow uploads up to your Imadeo upload limit.

```caddyfile
photos.example.com {
  reverse_proxy http://192.168.1.20:1111
}
```

Set the public URL, then start Imadeo:

```dotenv
PUBLIC_URL=https://photos.example.com
LOCAL_HTTP_ENABLED=true
```

Forward only the proxy’s HTTPS port from the router. Connect the mobile app to
`https://photos.example.com`; never forward `1111` or `6666` directly. A bare
WAN IP cannot have a normally trusted certificate, so use a domain/DDNS name or
a VPN for remote access.

## Configuration

`.env.example` documents every supported setting. The defaults are suitable for
a first installation; the most common adjustments are:

| Setting | What it controls |
| --- | --- |
| `UPLOAD_LOCATION` | Permanent data root; each account lives in `users/<user-id>` |
| `PUBLIC_URL` | LAN URL or the public HTTPS proxy address used in links and callbacks |
| `LOCAL_HTTP_ENABLED` | Allows HTTP sessions only for private LAN/VPN access |
| `TRASH_RETENTION_DAYS` | How long deleted items remain recoverable |
| `SMTP_*` | Email invitations; optional, with share links as the fallback |
| `GOOGLE_*` / `APPLE_*` | Optional social sign-in |
| `ML_*` | Visual-search plus people and pet-recognition worker behaviour |

Back up `UPLOAD_LOCATION` and `DB_DATA_LOCATION`. Application containers are
replaceable; these two paths are the parts that cannot be recreated.

## Updates

Pull the published images and replace the application containers:

```bash
docker compose pull
docker compose up -d --remove-orphans
```

The database, media and model cache are bind-mounted outside the containers, so
an update does not touch them. Set `IMADEO_VERSION` to pin a release; `latest`
tracks the newest stable images.

## Project

The public site and product guide are at [imadeo.app](https://imadeo.app).
Issues and feature requests belong in this repository.
