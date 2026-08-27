# Imadeo Docker installation

Keep this entire folder together. It contains the Compose configuration,
environment template, secret generator, and all persistent Imadeo data.

```sh
./generate-secrets.sh
docker compose up -d
```

The first command creates `.env` with unique database, Redis, authentication,
and Locked-folder secrets. It never replaces secrets that are already set.

After startup, open `http://<server-ip>:1111`. The mobile app uses that same
address on the LAN or through a VPN.

To update Imadeo later:

```sh
docker compose pull
docker compose up -d --remove-orphans
```
