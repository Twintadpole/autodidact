#!/usr/bin/env bash
# Proves two running tenants are kept apart, and that the live pool-service app is untouched.
# Reads only, except: each tenant's tech gets a new temporary password (to log in as them).
# Uses 3 logins per tenant; the app allows 5 per 15 minutes per address, so wait 15 minutes between runs.
#   bash gpf/demo/verify.sh <tenant-a> <tenant-b>
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIVE="${HERE}/../../pool-service"
source "${HERE}/../lib.sh"
set +e
A="${1:?tenant a}"; B="${2:?tenant b}"
pass=0; fail=0
ok() { echo "  PASS  $*"; pass=$((pass + 1)); }
bad() { echo "  FAIL  $*"; fail=$((fail + 1)); }
check() { local what="$1"; shift; if "$@" >/tmp/gpf-verify.log 2>&1; then ok "${what}"; else bad "${what}"; sed 's/^/        /' /tmp/gpf-verify.log | tail -8; fi; }
refuses() { local what="$1"; shift; if "$@" >/tmp/gpf-verify.log 2>&1; then bad "${what} (it did not refuse)"; else ok "${what}"; fi; }
owner_email() { sed -n 's/^OWNER_EMAIL=//p' "$(t_sec "$1")/api.env"; }
login_as() {
  curl -s -D - -o /dev/null -H "Host: $1.${GPF_DOMAIN}" -H 'content-type: application/json' \
    --data "{\"email\":\"$2\",\"password\":\"$3\"}" "http://${GPF_EDGE_BIND}/api/auth/login" | sed -n 's/^set-cookie: \(pool\.sid=[^;]*\).*/\1/Ip' | head -1
}
get() { curl -s -H "Host: $1.${GPF_DOMAIN}" -H "cookie: $2" "http://${GPF_EDGE_BIND}/api$3"; }
code() { curl -s -o /dev/null -w '%{http_code}' -H "Host: $1.${GPF_DOMAIN}" ${2:+-H "cookie: $2"} "http://${GPF_EDGE_BIND}/api$3"; }
live_state() {
  docker inspect -f '{{.Name}} {{.State.StartedAt}}' pool-service-api-1 pool-service-mongo-1 pool-service-ntfy-1
  ( source "${LIVE}/deploy/lib.sh"; record_counts )
}
LIVE_BEFORE="$(live_state)"

for t in "${A}" "${B}"; do
  echo "== ${t}"
  check "${t} is healthy and answers at ${t}.${GPF_DOMAIN}" test "$(t_health "${t}")" = healthy -a "$(code "${t}" '' /health)" = 200
  for s in api mongo; do check "${t} ${s}: no ports on the server" test -z "$(docker port "$(tdc "${t}" ps -q "${s}")")"; done
  check "${t}'s network is sealed (internal)" test "$(docker network inspect -f '{{.Internal}}' "$(t_net "${t}")")" = true
  check "${t}'s database refuses a login-less read" bash -c "! docker run --rm --network $(t_net "${t}") ${MONGO_IMAGE} mongosh --quiet --host mongo --eval 'db.getSiblingDB(\"pool\").customers.countDocuments()' >/dev/null 2>&1"
  refuses "${t}'s app can't reach the internet" tdc "${t}" exec -T api node -e "fetch('https://1.1.1.1', { signal: AbortSignal.timeout(5000) }).then(() => process.exit(0), () => process.exit(1))"
done

echo "== Between ${A} and ${B}"
b_mongo_ip="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$(tdc "${B}" ps -q mongo)")"
check "found ${B}'s database address (${b_mongo_ip})" test -n "${b_mongo_ip}"
refuses "${A}'s app can't reach ${B}'s database" tdc "${A}" exec -T api node -e "
  const s = require('net').connect(27017, '${b_mongo_ip}'); s.setTimeout(4000);
  s.on('connect', () => process.exit(0)); s.on('timeout', () => process.exit(1)); s.on('error', () => process.exit(1));"
check "different networks" test "$(t_get "${A}" SUBNET)" != "$(t_get "${B}" SUBNET)"
check "different database passwords and backup keys" bash -c "! cmp -s '$(t_sec "${A}")/mongo-root-password' '$(t_sec "${B}")/mongo-root-password' && ! cmp -s '$(t_sec "${A}")/restic-password' '$(t_sec "${B}")/restic-password'"
CA="$(login_as "${A}" "$(owner_email "${A}")" "$(cat "$(t_sec "${A}")/owner-password")")"
CB="$(login_as "${B}" "$(owner_email "${B}")" "$(cat "$(t_sec "${B}")/owner-password")")"
check "each owner logs in to their own business" test -n "${CA}" -a -n "${CB}"
check "${A}'s owner login doesn't work on ${B}" test -z "$(login_as "${B}" "$(owner_email "${A}")" "$(cat "$(t_sec "${A}")/owner-password")")"
check "${A}'s session doesn't work on ${B}" test "$(code "${B}" "${CA}" /customers)" = 401
na="$(tmongosh "${A}" pool <<<'db.customers.countDocuments({ deletedAt: null })')"
nb="$(tmongosh "${B}" pool <<<'db.customers.countDocuments({ deletedAt: null })')"
check "each has its own customers (${A}: ${na}, ${B}: ${nb})" test "${na}" -gt 0 -a "${nb}" -gt 0 -a "${na}" != "${nb}"
check "${A}'s customers are all ${A}'s (no ${B} email in its database)" test "$(tmongosh "${A}" pool <<<"db.customers.countDocuments({ email: /@${B}\\./ })")" = 0
list_a="$(get "${A}" "${CA}" /customers)"
check "${A}'s API lists only its own customers" bash -c "grep -q '@${A}.example' <<<\"\$1\" && ! grep -q '@${B}.example' <<<\"\$1\"" _ "${list_a}"

echo "== Techs see their own route, no money"
for t in "${A}" "${B}"; do
  c="$([[ "${t}" == "${A}" ]] && echo "${CA}" || echo "${CB}")"
  tech_id="$(get "${t}" "${c}" /team | grep -o '"_id":"[^"]*","name":"[^"]*","role":"tech"' | head -1 | cut -d'"' -f4)"
  pw="$(curl -s -X POST -H "Host: ${t}.${GPF_DOMAIN}" -H "cookie: ${c}" "http://${GPF_EDGE_BIND}/api/team/${tech_id}/reset-password" | sed -n 's/.*"password":"\([A-Za-z0-9]*\)".*/\1/p')"
  ct="$(login_as "${t}" "tech@${t}.example" "${pw}")"
  check "${t}'s tech logs in" test -n "${ct}"
  pull="$(get "${t}" "${ct}" /sync/pull)"
  mine="$(tmongosh "${t}" pool <<<"db.pools.countDocuments({ deletedAt: null, techId: '${tech_id}' })")"
  all="$(tmongosh "${t}" pool <<<'db.pools.countDocuments({ deletedAt: null })')"
  got="$(grep -o '"techId":"[^"]*"' <<<"${pull}" | wc -l)"
  check "${t}'s tech gets only their ${mine} of ${all} pools" test "${got}" = "${mine}" -a "${mine}" -lt "${all}"
  check "${t}'s tech gets no invoices, ledger, rates or costs" bash -c "grep -q '\"invoices\":\[\]' <<<'${pull//\'/}' && grep -q '\"ledger\":\[\]' <<<'${pull//\'/}' && ! grep -q 'monthlyRate\|\"cost\"\|\"price\"' <<<'${pull//\'/}'"
  check "${t}'s tech is refused the invoices screen" test "$(code "${t}" "${ct}" /invoices)" = 403
done

echo "== Live pool app"
LIVE_AFTER="$(live_state)"
check "live app untouched (same start times and record counts)" test "${LIVE_BEFORE}" = "${LIVE_AFTER}"
echo "${LIVE_AFTER}" | tail -1 | sed 's/^/        /'
echo
echo "${pass} passed, ${fail} failed"
(( fail == 0 ))
