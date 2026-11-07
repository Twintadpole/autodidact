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

# Live record counts (not deleted) per collection, as JSON. Used to prove a deploy kept every record.
COUNTED='["customers","pools","visits","issues","notes","photos","chemicals"]'
record_counts() {
  local db="${1:-pool}"
  dc exec -T mongo mongosh --quiet "${db}" --eval \
    "JSON.stringify(Object.fromEntries(${COUNTED}.map(c => [c, db.getCollection(c).countDocuments({ deletedAt: null })])))"
}

# Prints a before/after table; exits non-zero if any collection lost records.
compare_counts() {
  local before="$1" after="$2" l1="${3:-before}" l2="${4:-after}"
  dc exec -T mongo mongosh --quiet --eval "
    const b = ${before}, a = ${after}; let lost = false;
    print('collection    ' + '${l1}'.padStart(8) + '${l2}'.padStart(8));
    for (const c of ${COUNTED}) {
      const flag = (a[c] ?? 0) < (b[c] ?? 0) ? '   <-- FEWER' : '';
      if (flag) lost = true;
      print(c.padEnd(14) + String(b[c] ?? 0).padStart(8) + String(a[c] ?? 0).padStart(8) + flag);
    }
    if (lost) quit(3);"
}
