#!/usr/bin/env bash
# Shared helpers for tenant.sh. Source it; don't run it.
# Great Pool Friend (GPF): one stack per business ("tenant"). See gpf/README.md.
set -euo pipefail

GPF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${GPF_DIR}/.." && pwd)"
APP_SRC="${REPO_DIR}/pool-service"

# ---- Settings (environment; defaults are for a real install)
GPF_PREFIX="${GPF_PREFIX:-gpf}"                       # Docker name prefix; tests use "gpft"
GPF_ROOT="${GPF_ROOT:-${HOME}/gpf}"                   # tenants/<name>/ data, backups, exports
GPF_CONFIG="${GPF_CONFIG:-${HOME}/.config/gpf}"       # secrets, one folder per tenant (700/600)
# An install's own settings (GPF_DOMAIN, GPF_OFFSITE_LOCAL, …), so they needn't be typed each time.
# The environment wins over the file. No secrets in it.
if [[ -f "${GPF_CONFIG}/kit.env" ]]; then
  while IFS='=' read -r k v; do
    if [[ "${k}" =~ ^GPF_[A-Z0-9_]+$ && -z "${!k:-}" ]]; then export "${k}=${v}"; fi
  done < <(grep -E '^GPF_[A-Z0-9_]+=' "${GPF_CONFIG}/kit.env")
fi
GPF_DOMAIN="${GPF_DOMAIN:-}"                          # tenant address = <name>.<GPF_DOMAIN>
GPF_EDGE_BIND="${GPF_EDGE_BIND:-127.0.0.1:8080}"      # where Traefik listens (cloudflared connects here)
GPF_SUBNET_BASE="${GPF_SUBNET_BASE:-10.213}"          # tenant networks: <base>.<n*32>/27 style blocks
# Offsite copies (restic, encrypted with each tenant's own key). Either, both or neither:
GPF_OFFSITE_LOCAL="${GPF_OFFSITE_LOCAL:-}"            # folder holding a restic repo per tenant
GPF_R2_ENV="${GPF_R2_ENV:-}"                          # file with R2_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
GPF_R2_BUCKET="${GPF_R2_BUCKET:-}"
GPF_R2_PREFIX="${GPF_R2_PREFIX:-gpf}"                 # repo = <bucket>/<prefix>/<tenant>
GPF_PURGE_DAYS="${GPF_PURGE_DAYS:-90}"                # deleted tenants' final backups are kept this long
GPF_SUPPORT_EMAIL="${GPF_SUPPORT_EMAIL:-steven@evolutiondfw.com}"   # shown in the welcome guide and tester guide

MONGO_IMAGE="mongo:8"
RESTIC_IMAGE="restic/restic:0.18.1"
PLAYWRIGHT_IMAGE="mcr.microsoft.com/playwright:v1.56.1-noble"   # PDFs of the docs (tenant.sh welcome)
HELPER_IMAGE="alpine:latest"
API_REPO="${GPF_PREFIX}-api"

EDGE_PROJECT="${GPF_PREFIX}-edge"
EDGE_NET="${GPF_PREFIX}-edge"
TRAEFIK="${GPF_PREFIX}-traefik"

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

if docker info >/dev/null 2>&1; then DOCKER=(docker); else DOCKER=(sudo docker); fi
docker_() { "${DOCKER[@]}" "$@"; }

# Record counts must cover the same collections as the live app's deploy guard.
COUNTED="$(sed -n "s/^COUNTED='\(.*\)'$/\1/p" "${APP_SRC}/deploy/lib.sh")"
[[ "${COUNTED}" == '['*']' ]] || die "Could not read COUNTED from pool-service/deploy/lib.sh"

# ---- Tenant paths and names
valid_name() { [[ "$1" =~ ^[a-z][a-z0-9-]{1,30}[a-z0-9]$ ]]; }
need_name() {
  [[ -n "${1:-}" ]] || die "Give a tenant name"
  valid_name "$1" || die "Tenant names: 3-32 characters, a-z 0-9 and -, starting with a letter"
}
t_dir() { echo "${GPF_ROOT}/tenants/$1"; }
t_sec() { echo "${GPF_CONFIG}/tenants/$1"; }
t_project() { echo "${GPF_PREFIX}-t-$1"; }
t_net() { echo "${GPF_PREFIX}-t-$1"; }
t_exists() { [[ -f "$(t_sec "$1")/compose.env" ]]; }
need_tenant() { need_name "$1"; t_exists "$1" || die "No tenant '$1'"; }
tenants() { [[ -d "${GPF_CONFIG}/tenants" ]] && find "${GPF_CONFIG}/tenants" -mindepth 2 -maxdepth 2 -name compose.env -printf '%h\n' | xargs -rn1 basename | sort; }
t_get() { sed -n "s/^$2=//p" "$(t_sec "$1")/compose.env" | tail -1; }
t_set() {
  local f; f="$(t_sec "$1")/compose.env"
  { grep -v "^$2=" "${f}" || true; echo "$2=$3"; } > "${f}.new" && mv "${f}.new" "${f}"
}

# docker compose for one tenant
tdc() {
  local name="$1"; shift
  docker_ compose -p "$(t_project "${name}")" -f "${GPF_DIR}/templates/tenant.compose.yml" \
    --env-file "$(t_sec "${name}")/compose.env" "$@"
}
edc() {
  GPF_EDGE_BIND="${GPF_EDGE_BIND}" GPF_PREFIX="${GPF_PREFIX}" GPF_EDGE_DYNAMIC="${GPF_CONFIG}/edge/dynamic" \
    GPF_NOTICE_IMAGE="$(current_image)" docker_ compose -p "${EDGE_PROJECT}" -f "${GPF_DIR}/edge/compose.yml" "$@"
}

current_image() { cat "${GPF_CONFIG}/current-image" 2>/dev/null || true; }

# Short-lived admin job on one tenant's sealed network, with its Mongo root password mounted.
# Usage: tjob <name> [docker run options…] -- <command…>
tjob() {
  local name="$1"; shift
  local opts=()
  while [[ $# -gt 0 && "$1" != "--" ]]; do opts+=("$1"); shift; done
  shift
  docker_ run --rm -i --network "$(t_net "${name}")" \
    -v "$(t_sec "${name}")/mongo-root-password:/run/secrets/mongo_root_password:ro" \
    "${opts[@]}" "${MONGO_IMAGE}" "$@"
}
# mongosh as root in a job; the script comes on stdin. Usage: tmongosh <name> <db> <<<'script'
tmongosh() {
  local name="$1" db="$2"
  tjob "${name}" -- sh -c 'mongosh --quiet --host mongo -u root -p "$(cat /run/secrets/mongo_root_password)" --authenticationDatabase admin "$1" --eval "$(cat)"' _ "${db}"
}

t_counts() {
  tmongosh "$1" "${2:-pool}" <<<"JSON.stringify(Object.fromEntries(${COUNTED}.map(c => [c, db.getCollection(c).countDocuments({ deletedAt: null })])))"
}
# compare_counts <before-json> <after-json> [label1 label2]; non-zero if any collection lost records
compare_counts() {
  local before="$1" after="$2" l1="${3:-before}" l2="${4:-after}"
  docker_ run --rm -i "${MONGO_IMAGE}" mongosh --quiet --nodb --eval "
    const b = ${before}, a = ${after}; let lost = false;
    print('collection    ' + '${l1}'.padStart(8) + '${l2}'.padStart(8));
    for (const c of ${COUNTED}) {
      const flag = (a[c] ?? 0) < (b[c] ?? 0) ? '   <-- FEWER' : '';
      if (flag) lost = true;
      print(c.padEnd(14) + String(b[c] ?? 0).padStart(8) + String(a[c] ?? 0).padStart(8) + flag);
    }
    if (lost) quit(3);"
}

# Container health of a tenant's api ("healthy", "starting", "stopped", …)
t_health() {
  local id; id="$(tdc "$1" ps -q api 2>/dev/null || true)"
  [[ -n "${id}" ]] || { echo stopped; return; }
  docker_ inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${id}"
}
t_wait_healthy() {
  for _ in $(seq 1 90); do
    [[ "$(t_health "$1")" == healthy ]] && return 0
    sleep 2
  done
  tdc "$1" ps; tdc "$1" logs --tail 40
  die "Tenant $1 did not become healthy"
}
# HTTP status of <path> on a tenant's address, through the edge (as a visitor would arrive).
t_http() { curl -s -o /dev/null -w '%{http_code}' -H "Host: $1.${GPF_DOMAIN}" "http://${GPF_EDGE_BIND}$2"; }
# Traefik picks up a (re)started app a few seconds after it is healthy: wait up to 30 s for a 200.
t_edge_code() {
  local code=000
  for _ in $(seq 1 30); do code="$(t_http "$1" /api/health)"; [[ "${code}" == 200 ]] && break; sleep 1; done
  echo "${code}"
}

# ---- Offsite (restic). Each tenant has its own key: secrets/<name>/restic-password
# offsite_targets: prints "local" and/or "r2"
offsite_targets() {
  [[ -n "${GPF_OFFSITE_LOCAL}" ]] && echo local
  [[ -n "${GPF_R2_ENV}" && -s "${GPF_R2_ENV}" && -n "${GPF_R2_BUCKET}" ]] && echo r2
  return 0
}
# trestic <name> <local|r2> [docker run options…] -- <restic args…>
trestic() {
  local name="$1" target="$2"; shift 2
  local opts=()
  while [[ $# -gt 0 && "$1" != "--" ]]; do opts+=("$1"); shift; done
  shift
  local repo_opts=()
  if [[ "${target}" == local ]]; then
    mkdir -p "${GPF_OFFSITE_LOCAL}/${name}"
    repo_opts=(-v "${GPF_OFFSITE_LOCAL}/${name}:/repo" -e RESTIC_REPOSITORY=/repo)
  else
    local endpoint; endpoint="$(grep '^R2_ENDPOINT=' "${GPF_R2_ENV}" | cut -d= -f2-)"
    repo_opts=(--env-file "${GPF_R2_ENV}" -e RESTIC_REPOSITORY="s3:${endpoint%/}/${GPF_R2_BUCKET}/${GPF_R2_PREFIX}/${name}")
  fi
  # Runs as this user so local repo files stay ours; on the default network (never a tenant network).
  docker_ run --rm -i --user "$(id -u):$(id -g)" -e HOME=/tmp "${repo_opts[@]}" \
    -e RESTIC_PASSWORD_FILE=/run/restic-password -v "${TRESTIC_KEY:-$(t_sec "${name}")/restic-password}:/run/restic-password:ro" \
    "${opts[@]}" "${RESTIC_IMAGE}" --no-cache "$@"
}
