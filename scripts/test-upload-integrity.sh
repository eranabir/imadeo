#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

test_db="imadeo_upload_integrity_${RANDOM}_$$"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/imadeo-upload-integrity.XXXXXX")"
test_port=6677
server_pid=""
db_username="$(docker exec imadeo_postgres sh -c 'printf %s "$POSTGRES_USER"')"
db_password="$(docker exec imadeo_postgres sh -c 'printf %s "$POSTGRES_PASSWORD"')"
db_port="$(docker compose port database 5432)"
db_port="${db_port##*:}"
redis_port="$(docker compose port redis 6379)"
redis_port="${redis_port##*:}"
redis_password="$(docker exec imadeo_redis sh -c 'printf %s "$REDIS_PASSWORD"')"

cleanup() {
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  docker exec imadeo_postgres sh -c 'dropdb --if-exists -U "$POSTGRES_USER" "$1"' sh "$test_db" >/dev/null 2>&1 || true
  if [ -n "$test_root" ] && [ -d "$test_root" ]; then
    rm -rf -- "$test_root"
  fi
}
trap cleanup EXIT

docker exec imadeo_postgres sh -c 'createdb -U "$POSTGRES_USER" "$1"' sh "$test_db"

export DATABASE_URL="postgresql://${db_username}:${db_password}@127.0.0.1:${db_port}/${test_db}"
export MEDIA_LOCATION="$test_root/media"
export SERVER_PORT="$test_port"
export PUBLIC_URL="http://localhost:5174"
export LOCAL_HTTP_ENABLED=true
export NODE_ENV=development
export REDIS_HOSTNAME=127.0.0.1
export REDIS_PORT="$redis_port"
export REDIS_PASSWORD="$redis_password"
export REDIS_DBINDEX=14
export ML_ENABLED=false
export GEOCODING_ENABLED=false
export DUPLICATE_DETECTION_ENABLED=false
export MAX_UPLOAD_BYTES=52428800
export UPLOAD_TEST_BASE_URL="http://127.0.0.1:${test_port}/api"
export UPLOAD_TEST_MEDIA_ROOT="$MEDIA_LOCATION"

yarn workspace @imadeo/server db:migrate >/dev/null
yarn workspace @imadeo/server build >/dev/null
yarn workspace @imadeo/server start >"$test_root/server.log" 2>&1 &
server_pid=$!

for _attempt in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${test_port}/api/health" >/dev/null; then
    break
  fi
  sleep 0.25
done
if ! curl -fsS "http://127.0.0.1:${test_port}/api/health" >/dev/null; then
  cat "$test_root/server.log"
  exit 1
fi

yarn workspace @imadeo/server exec tsx scripts/upload-integrity.ts
