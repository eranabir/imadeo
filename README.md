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
- Separate web, API and background-processing containers, so a busy library cannot block browsing.

## Install

Imadeo is designed to run with Docker Compose. You need a server with Docker
and Docker Compose installed, plus enough disk space for your originals and
thumbnails.

Download only the Docker installation files and keep them together:

```bash
mkdir imadeo && cd imadeo
curl -fsSLO https://raw.githubusercontent.com/eranabir/imadeo/master/docker/docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/eranabir/imadeo/master/docker/generate-secrets.sh
curl -fsSL https://raw.githubusercontent.com/eranabir/imadeo/master/docker/.env.example -o .env.example
chmod +x generate-secrets.sh
./generate-secrets.sh
docker compose up -d
```

The generator creates `.env` and fills the database, Redis, JWT and
Locked-folder secrets without overwriting existing values. By default, media,
database files, and model files are all stored inside this installation folder.

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

For Nginx Proxy Manager or a hand-written Nginx proxy, allow the upload body
and keep the upstream connection open while a large file is verified:

```nginx
client_max_body_size 50G;
proxy_request_buffering off;
proxy_read_timeout 1h;
proxy_send_timeout 1h;
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
| `API_*` / `WORKER_*` | CPU and memory reserved for responsive requests and bounded background work |

Uploads store the untouched original first. Web uploads also provide a small
temporary browser preview, then Redis starts durable metadata and thumbnail
jobs after the batch and foreground activity become quiet. The dedicated
worker processes one media task at a time; video optimisation, search and
People & Pets share a separate one-at-a-time heavy lane and never overlap
thumbnail generation. Restarting a container does not lose queued work.

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
