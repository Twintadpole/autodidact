#!/usr/bin/env bash
# Shared helpers for the deploy scripts. Source it; don't run it.
set -euo pipefail

# pool-service/ (the folder with docker-compose.yml)
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_IMAGE="pool-service-api"

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

# Use plain docker if this user may (docker group), otherwise sudo.
if docker info >/dev/null 2>&1; then
  DOCKER=(docker)
else
  DOCKER=(sudo docker)
fi
docker_() { "${DOCKER[@]}" "$@"; }
dc() { (cd "${APP_DIR}" && "${DOCKER[@]}" compose "$@"); }

# Hash a password (read from stdin) with the app's own argon2 settings, using the built image.
hash_password() { docker_ run --rm -i "${API_IMAGE}" node server/dist/cli/hash-password.js -; }

wait_healthy() {
  local url="http://127.0.0.1:3000/api/health"
  for _ in $(seq 1 60); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      curl -fsS "${url}"; echo
      return 0
    fi
    sleep 2
  done
  dc ps
  dc logs --tail 50 api
  die "API did not become healthy at ${url}"
}
