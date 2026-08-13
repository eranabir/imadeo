#!/bin/sh

set -eu

ENV_FILE=${1:-.env}
EXAMPLE_FILE=${2:-.env.example}

if [ ! -f "$ENV_FILE" ]; then
  if [ ! -f "$EXAMPLE_FILE" ]; then
    echo "Missing $ENV_FILE and $EXAMPLE_FILE." >&2
    exit 1
  fi

  cp "$EXAMPLE_FILE" "$ENV_FILE"
  echo "Created $ENV_FILE from $EXAMPLE_FILE"
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "OpenSSL is required to generate secure secrets." >&2
  exit 1
fi

temporary_file=$(mktemp "${TMPDIR:-/tmp}/imadeo-env.XXXXXX")
trap 'rm -f "$temporary_file"' EXIT HUP INT TERM

value_for() {
  sed -n "s/^$1=//p" "$ENV_FILE" | head -n 1
}

replace_value() {
  key=$1
  value=$2
  awk -v key="$key" -v value="$value" '
    BEGIN { replaced = 0 }
    index($0, key "=") == 1 { print key "=" value; replaced = 1; next }
    { print }
    END { if (!replaced) print key "=" value }
  ' "$ENV_FILE" > "$temporary_file"
  mv "$temporary_file" "$ENV_FILE"
  temporary_file=$(mktemp "${TMPDIR:-/tmp}/imadeo-env.XXXXXX")
}

generate_if_default() {
  key=$1
  bytes=$2
  current=$(value_for "$key")

  case "$current" in
    ''|change-me-please|replace-with-64-bytes-of-hex|replace-with-32-bytes-of-hex)
      replace_value "$key" "$(openssl rand -hex "$bytes")"
      echo "Generated $key"
      ;;
    *)
      echo "Kept existing $key"
      ;;
  esac
}

generate_if_default DB_PASSWORD 32
generate_if_default REDIS_PASSWORD 32
generate_if_default JWT_SECRET 64
generate_if_default VAULT_MASTER_KEY 32
chmod 600 "$ENV_FILE"

echo "Secrets saved to $ENV_FILE"
