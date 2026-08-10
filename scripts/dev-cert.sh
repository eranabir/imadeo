#!/usr/bin/env bash

# A local-only certificate for Vite. It is intentionally ignored by git and is
# regenerated only when missing, so browser trust decisions remain stable.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="$ROOT/.dev/certs"
KEY="$CERT_DIR/localhost-key.pem"
CERT="$CERT_DIR/localhost.pem"

if [[ -f "$KEY" && -f "$CERT" ]]; then
  exit 0
fi

mkdir -p "$CERT_DIR"

SAN="DNS:localhost,IP:127.0.0.1"
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
if [[ -n "$LAN_IP" ]]; then
  SAN="$SAN,IP:$LAN_IP"
fi

openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 825 \
  -keyout "$KEY" \
  -out "$CERT" \
  -subj '/CN=localhost' \
  -addext "subjectAltName=$SAN" \
  >/dev/null 2>&1

echo "Created local HTTPS certificate at .dev/certs/localhost.pem"
