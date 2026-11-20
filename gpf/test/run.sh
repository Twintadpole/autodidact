#!/usr/bin/env bash
# Throwaway test of the tenant kit on one machine. Never touches the live pool-service stack:
# everything is named gpft-*, lives under /var/tmp/gpft, Traefik listens on 127.0.0.1:8089, and the
# script proves at the end that the live containers weren't restarted and kept every record.
#
#   bash gpf/test/run.sh [--r2]     --r2 also sends test backups to the R2 bucket, under gpf-test/
#                                   (uses ~/.config/pool-backup/r2.env; removed again at the end)
# Needs an image: GPF_PREFIX=gpft GPF_ROOT=/var/tmp/gpft GPF_CONFIG=/var/tmp/gpft/config bash gpf/tenant.sh build
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GPF="${HERE}/../tenant.sh"
LIVE="${HERE}/../../pool-service"

export GPF_PREFIX=gpft GPF_ROOT=/var/tmp/gpft GPF_CONFIG=/var/tmp/gpft/config GPF_DOMAIN=gpf.test
export GPF_EDGE_BIND=127.0.0.1:8089 GPF_SUBNET_BASE=10.214 GPF_OFFSITE_LOCAL=/var/tmp/gpft/offsite
R2=0
if [[ "${1:-}" == --r2 ]]; then
  R2=1
  export GPF_R2_ENV="${HOME}/.config/pool-backup/r2.env" GPF_R2_BUCKET=pool-backup GPF_R2_PREFIX=gpf-test
fi
source "${HERE}/../lib.sh"
set +e

pass=0; fail=0
ok() { echo "  PASS  $*"; pass=$((pass + 1)); }
bad() { echo "  FAIL  $*"; fail=$((fail + 1)); }
check() { local what="$1"; shift; if "$@" >/var/tmp/gpft-check.log 2>&1; then ok "${what}"; else bad "${what}"; sed 's/^/        /' /var/tmp/gpft-check.log | tail -15; fi; }
refuses() { local what="$1"; shift; if "$@" >/var/tmp/gpft-check.log 2>&1; then bad "${what} (it did not refuse)"; else ok "${what}"; fi; }
run() { echo "  \$ tenant.sh $*"; bash "${GPF}" "$@" > >(sed 's/^/        /') 2>&1; }
http() { curl -s -o /dev/null -w '%{http_code}' -H "Host: $1.${GPF_DOMAIN}" "http://${GPF_EDGE_BIND}$2"; }
pw() { cat "$(t_sec "$1")/owner-password"; }
login_cookie() { # session cookie after logging in as tenant $1 with password of tenant $2
  curl -s -D - -o /dev/null -H "Host: $1.${GPF_DOMAIN}" -H 'content-type: application/json' \
    --data "{\"password\":\"$(pw "$2")\",\"remember\":false}" "http://${GPF_EDGE_BIND}/api/auth/login" |
    sed -n 's/^set-cookie: \(pool\.sid=[^;]*\).*/\1/Ip' | head -1
}
count() { tmongosh "$1" pool <<<"db.$2.countDocuments({ deletedAt: null })"; }
api_exec() { tdc "$1" exec -T api "${@:2}"; }

live_state() { # live containers' start times + record counts
  docker inspect -f '{{.Name}} {{.State.StartedAt}}' pool-service-api-1 pool-service-mongo-1 pool-service-ntfy-1
  ( source "${LIVE}/deploy/lib.sh"; record_counts )
}

cleanup() {
  for s in $(ls -1 "${GPF_CONFIG}/deleted" 2>/dev/null); do GPF_PURGE_DAYS=0 bash "${GPF}" purge "${s}" --confirm "${s}" >/dev/null; done
  for t in $(tenants); do tdc "${t}" down >/dev/null 2>&1; done
  [[ -e "${GPF_CONFIG}/current-image" ]] && edc down >/dev/null 2>&1
  docker ps -aq --filter name=gpft- | xargs -r docker rm -f >/dev/null
  docker network ls -q --filter name=gpft- | xargs -r docker network rm >/dev/null
  docker run --rm -v /var/tmp/gpft:/t "${HELPER_IMAGE}" rm -rf /t/tenants /t/deleted /t/offsite /t/config/tenants /t/config/deleted /t/config/edge
}
if [[ "${1:-}" == --clean || "${2:-}" == --clean ]]; then cleanup; echo "Test leftovers removed"; exit 0; fi
setup_ok() { (( fail == 0 )) || { echo "Setup failed; stopping. Leftovers: bash $0 --clean"; exit 1; }; }

echo "== Live app before"
LIVE_BEFORE="$(live_state)"; echo "${LIVE_BEFORE}" | sed 's/^/  /'
[[ -n "$(current_image)" ]] || { echo "No test image: build it first (see the top of this file)"; exit 1; }
[[ -e "${GPF_ROOT}/tenants" ]] && { echo "Old test data in ${GPF_ROOT}; remove it first: bash $0 --clean"; exit 1; }
BASE_IMAGE="$(current_image)"; BASE_IMAGE="${BASE_IMAGE%-next}"
bash "${GPF}" use-image "${BASE_IMAGE}" >/dev/null

echo "== Edge and two tenants"
check "edge starts" run edge-up
check "create alpha" run create alpha
check "create bravo" run create bravo
refuses "create alpha again" bash "${GPF}" create alpha
refuses "bad tenant name" bash "${GPF}" create 'Bad_Name'
run list
check "alpha healthy" test "$(t_health alpha)" = healthy
check "bravo healthy" test "$(t_health bravo)" = healthy
check "alpha.gpf.test answers 200" test "$(http alpha /api/health)" = 200
check "bravo.gpf.test answers 200" test "$(http bravo /)" = 200
check "unknown name answers 404" test "$(http charlie /api/health)" = 404
check "different networks" test "$(t_get alpha SUBNET)" != "$(t_get bravo SUBNET)"
setup_ok

echo "== Logins and data stay apart"
CA="$(login_cookie alpha alpha)"
check "alpha owner logs in to alpha" test -n "${CA}"
check "alpha's password is refused by bravo" test -z "$(login_cookie bravo alpha)"
cid="$(cat /proc/sys/kernel/random/uuid)"
code="$(curl -s -o /var/tmp/gpft-post.json -w '%{http_code}' -H "Host: alpha.${GPF_DOMAIN}" -H "cookie: ${CA}" \
  -H 'content-type: application/json' --data "{\"_id\":\"${cid}\",\"name\":\"Test customer A\"}" "http://${GPF_EDGE_BIND}/api/customers")"
check "add a customer to alpha (HTTP ${code})" test "${code}" = 200 -o "${code}" = 201
check "alpha has 1 customer" test "$(count alpha customers)" = 1
check "bravo has 0 customers" test "$(count bravo customers)" = 0

echo "== Sealed networks"
for t in alpha bravo; do
  for s in api mongo; do
    id="$(tdc "${t}" ps -q "${s}")"
    check "${t} ${s}: no host ports" test -z "$(docker port "${id}")"
  done
done
check "alpha's app reaches its own database (control)" api_exec alpha node -e "
  const s = require('net').connect(27017, 'mongo'); s.setTimeout(4000);
  s.on('connect', () => process.exit(0)); s.on('timeout', () => process.exit(1)); s.on('error', () => process.exit(1));"
bravo_mongo_ip="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$(tdc bravo ps -q mongo)")"
check "found bravo's database address" test -n "${bravo_mongo_ip}"
refuses "alpha's app can't reach bravo's database (${bravo_mongo_ip})" api_exec alpha node -e "
  const s = require('net').connect(27017, '${bravo_mongo_ip}'); s.setTimeout(4000);
  s.on('connect', () => process.exit(0)); s.on('timeout', () => process.exit(1)); s.on('error', () => process.exit(1));"
refuses "alpha's app can't reach the internet" api_exec alpha node -e "
  fetch('https://1.1.1.1', { signal: AbortSignal.timeout(5000) }).then(() => process.exit(0), () => process.exit(1))"
refuses "alpha's app can't look up internet names" api_exec alpha node -e "
  require('dns').lookup('cloudflare.com', (e) => process.exit(e ? 1 : 0))"
check "the root login can read alpha's database (control)" tmongosh alpha pool <<<'db.customers.countDocuments()'
refuses "alpha's database refuses a login-less read" tjob alpha -- mongosh --quiet --host mongo --eval 'db.getSiblingDB("pool").customers.countDocuments()'
check "alpha's app user can read its own database (control)" tjob alpha -- sh -c \
  "mongosh --quiet 'mongodb://app:$(cat "$(t_sec alpha)/mongo-app-password")@mongo:27017/pool?authSource=pool&directConnection=true' --eval 'db.customers.countDocuments()'"
refuses "alpha's app user can't read other databases" tjob alpha -- sh -c \
  "mongosh --quiet 'mongodb://app:$(cat "$(t_sec alpha)/mongo-app-password")@mongo:27017/pool?authSource=pool&directConnection=true' --eval 'db.getSiblingDB(\"admin\").system.users.countDocuments()'"
check "secret files are private (600)" test -z "$(find "$(t_sec alpha)" -type f ! -perm 600)"
check "secrets folder is private (700)" test "$(stat -c %a "${GPF_CONFIG}")" = 700

echo "== Backups"
check "backup alpha (local dump + offsite)" run backup alpha
check "alpha LAST_OFFSITE written" test -s "$(t_dir alpha)/backups/LAST_OFFSITE"
check "backup all" run backup all
check "restore-check alpha (local dump)" run restore-check alpha
check "restore-check alpha --offsite local" run restore-check alpha --offsite local
if (( R2 )); then check "restore-check alpha --offsite r2" run restore-check alpha --offsite r2; fi
check "alpha's local offsite copy can't be read with bravo's key" bash -c "! TRESTIC_KEY='$(t_sec bravo)/restic-password' bash -c 'source ${HERE}/../lib.sh; trestic alpha local -- snapshots' >/dev/null 2>&1"

echo "== Update (new image tag)"
img="${BASE_IMAGE}"; docker tag "${img}" "${img}-next"
check "use-image" run use-image "${img}-next"
check "update all" run update all
check "alpha on the new image" test "$(t_get alpha IMAGE)" = "${img}-next"
check "alpha still has its customer" test "$(count alpha customers)" = 1
check "alpha answers after update" test "$(http alpha /api/health)" = 200

echo "== Suspend / resume"
check "suspend alpha" run suspend alpha
check "alpha answers 503 (page)" test "$(http alpha /)" = 503
check "alpha answers 503 (api)" test "$(http alpha /api/sync/pull)" = 503
check "bravo unaffected" test "$(http bravo /api/health)" = 200
check "backup works while suspended" run backup alpha
check "resume alpha" run resume alpha
check "alpha answers 200 again" test "$(http alpha /api/health)" = 200
check "alpha still has its customer" test "$(count alpha customers)" = 1

echo "== Export, delete, purge"
refuses "delete without a recent export" bash "${GPF}" delete bravo --confirm bravo
check "export alpha" run export alpha
x="$(ls -1d "$(t_dir alpha)"/exports/*/ | tail -1)"
check "export is an Excel file" test "$(head -c2 "${x}/everything.xlsx")" = PK
check "photos.zip made" test -s "${x}/photos.zip"
refuses "delete with the wrong name" bash "${GPF}" delete alpha --confirm bravo
check "alpha still running after refusals" test "$(t_health alpha)" = healthy
check "delete alpha" run delete alpha --confirm alpha
stamp="$(ls -1 "${GPF_CONFIG}/deleted" | grep '^alpha-' | tail -1)"
check "alpha's containers are gone" test -z "$(docker ps -aq --filter label=com.docker.compose.project=gpft-t-alpha)"
check "alpha's network is gone" bash -c "! docker network inspect gpft-t-alpha >/dev/null 2>&1"
check "alpha's final dump kept" bash -c "ls ${GPF_ROOT}/deleted/${stamp}/backups/pool-final-*.archive.gz"
check "alpha's export kept" bash -c "ls ${GPF_ROOT}/deleted/${stamp}/exports/*/everything.xlsx"
check "alpha's live data removed" test ! -e "${GPF_ROOT}/deleted/${stamp}/data"
check "bravo unaffected" test "$(http bravo /api/health)" = 200
refuses "purge before 90 days" env GPF_PURGE_DAYS=90 bash "${GPF}" purge "${stamp}" --confirm "${stamp}"
check "purge alpha (test: 0 days)" env GPF_PURGE_DAYS=0 bash "${GPF}" purge "${stamp}" --confirm "${stamp}"
check "alpha's kept copies are gone" test ! -e "${GPF_ROOT}/deleted/${stamp}" -a ! -e "${GPF_OFFSITE_LOCAL}/alpha"

echo "== Clean up"
run export bravo >/dev/null
check "delete bravo" run delete bravo --confirm bravo
for s in $(ls -1 "${GPF_CONFIG}/deleted"); do GPF_PURGE_DAYS=0 bash "${GPF}" purge "${s}" --confirm "${s}" >/dev/null; done
if (( R2 )); then
  # The purges removed every snapshot; this removes the empty repositories too. Only gpf-test/.
  [[ "${GPF_R2_PREFIX}" == gpf-test ]] && docker run --rm --env-file "${GPF_R2_ENV}" amazon/aws-cli \
    s3 rm --recursive --quiet "s3://${GPF_R2_BUCKET}/gpf-test/" \
    --endpoint-url "$(grep '^R2_ENDPOINT=' "${GPF_R2_ENV}" | cut -d= -f2-)" && ok "R2 gpf-test/ removed"
fi
cleanup
check "no gpft containers left" test -z "$(docker ps -aq --filter name=gpft-)"
check "no gpft networks left" test -z "$(docker network ls -q --filter name=gpft-)"
bash "${GPF}" use-image "${BASE_IMAGE}" >/dev/null; docker rmi "${BASE_IMAGE}-next" >/dev/null

echo "== Live app after"
LIVE_AFTER="$(live_state)"; echo "${LIVE_AFTER}" | sed 's/^/  /'
check "live app untouched (same start times and record counts)" test "${LIVE_BEFORE}" = "${LIVE_AFTER}"

echo
echo "${pass} passed, ${fail} failed"
(( fail == 0 ))
