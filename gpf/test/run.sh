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
owner_email() { sed -n 's/^OWNER_EMAIL=//p' "$(t_sec "$1")/api.env"; }
login_as() { # login_as <tenant> <email> <password>: session cookie, or nothing
  curl -s -D - -o /dev/null -H "Host: $1.${GPF_DOMAIN}" -H 'content-type: application/json' \
    --data "{\"email\":\"$2\",\"password\":\"$3\",\"remember\":false}" "http://${GPF_EDGE_BIND}/api/auth/login" |
    sed -n 's/^set-cookie: \(pool\.sid=[^;]*\).*/\1/Ip' | head -1
}
login_cookie() { login_as "$1" "$(owner_email "$2")" "$(pw "$2")"; } # tenant $1 with tenant $2's owner login
api() { # api <tenant> <cookie> <method> <path> [json]: prints "<status> <body>"
  curl -s -w '\n%{http_code}' -X "$3" -H "Host: $1.${GPF_DOMAIN}" -H "cookie: $2" ${5:+-H 'content-type: application/json' --data "$5"} "http://${GPF_EDGE_BIND}/api$4" |
    { body="$(cat)"; echo "${body##*$'\n'} ${body%$'\n'*}"; }
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
  rm -rf "${GPF_ROOT}/monitor"
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
check "create alpha (owner login owner@alpha.example)" run create alpha owner@alpha.example
check "create bravo (owner login \"owner\")" run create bravo
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

echo "== Weekly restore check and alerts"
check "restore-check all --offsite (every tenant)" run restore-check all --offsite
check "alpha LAST_RESTORE_CHECK written" test -s "$(t_dir alpha)/backups/LAST_RESTORE_CHECK"
check "bravo LAST_RESTORE_CHECK written" test -s "$(t_dir bravo)/backups/LAST_RESTORE_CHECK"
# A throwaway ntfy (no logins) stands in for the phone.
docker run -d --name gpft-ntfy -p 127.0.0.1:8095:80 binwiederhier/ntfy:v2.15.0 serve >/dev/null
for _ in $(seq 1 20); do curl -fs http://127.0.0.1:8095/v1/health >/dev/null && break; sleep 1; done
export GPF_NTFY_URL=http://127.0.0.1:8095/gpft-alerts
alerts() { curl -s "http://127.0.0.1:8095/gpft-alerts/json?poll=1&since=all" | grep -o '"title":"[^"]*"' | cut -d'"' -f4; }
mon() { bash "${HERE}/../monitor.sh" "$@" >/var/tmp/gpft-mon.log 2>&1; }
check "monitor test reaches ntfy" bash -c "bash '${HERE}/../monitor.sh' test && sleep 1 && curl -s 'http://127.0.0.1:8095/gpft-alerts/json?poll=1&since=all' | grep -q 'GPF test alert'"
mon health; mon backups; mon disk
check "all healthy: no open alerts" test -z "$(ls "${GPF_ROOT}/monitor/"*.down 2>/dev/null)"
check "alpha's MONITOR_STATUS written" grep -q '^checked ' "$(t_dir alpha)/backups/MONITOR_STATUS"
tdc bravo stop api >/dev/null 2>&1
mon health
check "one failed check: no alert yet" test ! -e "${GPF_ROOT}/monitor/bravo.health.down"
mon health
check "two failed checks: bravo DOWN alert" bash -c "sleep 1; curl -s 'http://127.0.0.1:8095/gpft-alerts/json?poll=1&since=all' | grep -q 'bravo is DOWN'"
mon health
check "no repeat alert" test "$(alerts | grep -c 'bravo is DOWN')" = 1
check "bravo's status file shows it" grep -q '^down health ' "$(t_dir bravo)/backups/MONITOR_STATUS"
check "alpha's status file doesn't" bash -c "! grep -q '^down' '$(t_dir alpha)/backups/MONITOR_STATUS'"
check "alpha still answers" test "$(http alpha /api/health)" = 200
tdc bravo start api >/dev/null 2>&1; t_wait_healthy bravo >/dev/null
for _ in $(seq 1 30); do [[ "$(http bravo /api/health)" == 200 ]] && break; sleep 1; done
mon health
check "bravo back: OK-again alert" bash -c "sleep 1; curl -s 'http://127.0.0.1:8095/gpft-alerts/json?poll=1&since=all' | grep -q 'bravo is back up'"
echo "2020-01-01T00:00:00Z" > "$(t_dir alpha)/backups/LAST_BACKUP"
mon backups
check "old backup: alpha backup alert" bash -c "sleep 1; curl -s 'http://127.0.0.1:8095/gpft-alerts/json?poll=1&since=all' | grep -q 'alpha: backup problem'"
check "alpha's System card shows it" bash -c "api() { curl -s -H 'Host: alpha.${GPF_DOMAIN}' -H 'cookie: ${CA}' 'http://${GPF_EDGE_BIND}/api/system/status'; }; api | grep -q '\"name\":\"backups\"'"
check "bravo's backups fine" test ! -e "${GPF_ROOT}/monitor/bravo.backups.down"
run backup alpha >/dev/null; mon backups
check "after a backup: alpha backups OK again" test ! -e "${GPF_ROOT}/monitor/alpha.backups.down"
docker stop gpft-traefik >/dev/null; mon health; mon health
check "edge down: one edge alert, not one per tenant" bash -c "sleep 1; a=\$(curl -s 'http://127.0.0.1:8095/gpft-alerts/json?poll=1&since=all'); grep -q 'GPF edge is DOWN' <<<\"\$a\" && ! grep -q 'alpha is DOWN' <<<\"\$a\""
docker start gpft-traefik >/dev/null; sleep 3; mon health
check "edge back: OK again" test ! -e "${GPF_ROOT}/monitor/edge.down"
docker rm -f gpft-ntfy >/dev/null; unset GPF_NTFY_URL
check "cron lines: nightly backup, weekly restore check, alerts" bash -c "c=\$(bash '${GPF}' cron); grep -q 'tenant.sh backup all' <<<\"\$c\" && grep -q 'restore-check all --offsite' <<<\"\$c\" && grep -q 'monitor.sh health' <<<\"\$c\" && grep -q 'GPF_PREFIX=gpft' <<<\"\$c\""

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

echo "== Logins (owner, tech, billing)"
check "alpha’s old login name \"owner\" is refused" test -z "$(login_as alpha owner "$(pw alpha)")"
CA="$(login_cookie alpha alpha)"
check "alpha’s owner logs in with their email" test -n "${CA}"
check "the first password is temporary (must be changed)" bash -c "grep -q '\"mustChangePassword\":true' <<<'$(api alpha "${CA}" GET /auth/me)'"
r="$(api alpha "${CA}" POST /team '{"email":"tech@alpha.example","name":"Alpha Tech"}')"
check "the owner adds a tech (HTTP ${r%% *})" test "${r%% *}" = 201
TECHPW="$(sed -n 's/.*"password":"\([A-Za-z0-9]*\)".*/\1/p' <<<"${r#* }")"
CT="$(login_as alpha tech@alpha.example "${TECHPW}")"
check "the tech logs in" test -n "${CT}"
check "the tech can read customers" test "$(api alpha "${CT}" GET /customers | cut -d' ' -f1)" = 200
check "the tech can't read invoices" test "$(api alpha "${CT}" GET /invoices | cut -d' ' -f1)" = 403
check "the tech's login doesn't work on bravo" test -z "$(login_as bravo tech@alpha.example "${TECHPW}")"
check "tenant.sh users alpha: owner and tech, tech active this month" bash -c "bash '${GPF}' users alpha | grep -E '^tech@alpha.example +Alpha Tech +tech +yes +yes'"
check "tenant.sh list: alpha has 1 tech this month" bash -c "bash '${GPF}' list | grep -E '^alpha +active +healthy +1 '"
billing="$(bash "${GPF}" billing)"
echo "${billing}" | sed 's/^/        /'
check "billing: alpha 1 tech \$75, bravo 0 \$75, total \$150" bash -c "grep -qE '^alpha .* 1 +\\\$75$' <<<'${billing}' && grep -qE '^bravo .* 0 +\\\$75$' <<<'${billing}' && grep -qE '^TOTAL .*\\\$150$' <<<'${billing}'"
check "users works while a tenant is suspended" bash -c "bash '${GPF}' suspend bravo >/dev/null && bash '${GPF}' users bravo | grep -q '^owner ' ; rc=\$?; bash '${GPF}' resume bravo >/dev/null; exit \$rc"
manifest_name() { curl -s -H "Host: $1.${GPF_DOMAIN}" "http://${GPF_EDGE_BIND}/manifest.json" | sed -n 's/.*"name":"\([^"]*\)".*/\1/p' | head -1; }
check "a new business starts with blank Business details" test "$(api alpha "${CA}" GET /settings)" = "200 []"
check "a blank business is called Great Pool Friend (home screen)" test "$(manifest_name alpha)" = "Great Pool Friend"
r="$(api alpha "${CA}" POST /settings '{"_id":"00000000-0000-4000-8000-000000000001","businessName":"Alpha Pools"}')"
check "alpha’s owner names the business (HTTP ${r%% *})" test "${r%% *}" = 201
check "alpha’s home screen says Alpha Pools" test "$(manifest_name alpha)" = "Alpha Pools"
check "bravo’s still says Great Pool Friend" test "$(manifest_name bravo)" = "Great Pool Friend"
check "owner-password alpha" run owner-password alpha
check "the owner's old session is signed out" test "$(api alpha "${CA}" GET /auth/me | cut -d' ' -f1)" = 401
check "the new temporary password works (and must be changed)" bash -c "c=\$(curl -s -D - -o /dev/null -H 'Host: alpha.${GPF_DOMAIN}' -H 'content-type: application/json' --data '{\"email\":\"owner@alpha.example\",\"password\":\"$(pw alpha)\"}' http://${GPF_EDGE_BIND}/api/auth/login | sed -n 's/^set-cookie: \\(pool\\.sid=[^;]*\\).*/\\1/Ip'); curl -s -H 'Host: alpha.${GPF_DOMAIN}' -H \"cookie: \$c\" http://${GPF_EDGE_BIND}/api/auth/me | grep -q '\"mustChangePassword\":true'"
check "the tech's session is untouched" test "$(api alpha "${CT}" GET /auth/me | cut -d' ' -f1)" = 200

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
