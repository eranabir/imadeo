#!/usr/bin/env bash
#
# Keeps the Imadeo development stack alive.
#
# Checks every 20 seconds and restarts whichever piece has died:
#   - Docker Desktop (the daemon does not start on login on this machine)
#   - the postgres and redis containers
#   - the API server and the Vite dev server (both from `yarn dev`)
#
# Run it detached:  bash scripts/dev-watchdog.sh &
# Stop it:          touch .dev/watchdog.stop
#
# It is deliberately idempotent: every action is a no-op when the thing it
# manages is already healthy, so it can be started twice without harm.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

LOG_DIR="$ROOT/.dev"
mkdir -p "$LOG_DIR"

WATCHDOG_LOG="$LOG_DIR/watchdog.log"
DEV_LOG="$LOG_DIR/dev.log"
STOP_FILE="$LOG_DIR/watchdog.stop"
DOCKER_EXE="/c/Program Files/Docker/Docker/Docker Desktop.exe"

INTERVAL=20
# Give a freshly started `yarn dev` time to compile before judging it dead.
GRACE=75
last_start=0

log() {
  printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >>"$WATCHDOG_LOG"
}

docker_up()   { docker info >/dev/null 2>&1; }
container_up() { docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^$1$"; }
api_up()      { curl -sf -m 5 http://127.0.0.1:6666/api >/dev/null 2>&1; }
web_up()      { curl -sf -o /dev/null -m 5 http://localhost:5173/ 2>/dev/null; }

start_dev() {
  # `yarn dev` owns both the API and the web server, so one relaunch covers both.
  log 'starting yarn dev'
  nohup yarn dev >"$DEV_LOG" 2>&1 &
  last_start=$(date +%s)
}

log '--- watchdog started ---'
rm -f "$STOP_FILE"

while true; do
  [ -f "$STOP_FILE" ] && { log 'stop file found, exiting'; rm -f "$STOP_FILE"; exit 0; }

  if ! docker_up; then
    log 'docker daemon down, launching Docker Desktop'
    [ -x "$DOCKER_EXE" ] && "$DOCKER_EXE" >/dev/null 2>&1 &
    # The daemon takes a while; skip the rest of this pass rather than pile up
    # container commands that are certain to fail.
    sleep 45
    continue
  fi

  if ! container_up imadeo_postgres || ! container_up imadeo_redis; then
    log 'database or redis container down, bringing them up'
    docker compose up -d database redis >>"$WATCHDOG_LOG" 2>&1
    sleep 8
  fi

  now=$(date +%s)
  if [ $((now - last_start)) -gt "$GRACE" ]; then
    if ! api_up; then
      log 'api not responding, restarting dev servers'
      start_dev
    elif ! web_up; then
      log 'web not responding, restarting dev servers'
      start_dev
    fi
  fi

  sleep "$INTERVAL"
done
