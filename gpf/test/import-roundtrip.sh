#!/usr/bin/env bash
# Customer & pool import, through the tenant kit (GPF item 2, segment 3). Throwaway, like run.sh:
#   1. two tenants, alpha (filled with varied data) and bravo (blank)
#   2. tenant.sh export alpha → everything.xlsx
#   3. bravo imports it: every customer and pool field must match alpha's; again = nothing to do;
#      alpha's own export into alpha = nothing to do; Undo empties bravo
#   4. clean up, and check the live app wasn't touched
# Needs the image: GPF_PREFIX=gpft GPF_ROOT=/var/tmp/gpft GPF_CONFIG=/var/tmp/gpft/config bash gpf/tenant.sh build
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GPF="${HERE}/../tenant.sh"
LIVE="${HERE}/../../pool-service"
export GPF_PREFIX=gpft GPF_ROOT=/var/tmp/gpft GPF_CONFIG=/var/tmp/gpft/config GPF_DOMAIN=gpf.test
export GPF_EDGE_BIND=127.0.0.1:8089 GPF_SUBNET_BASE=10.214 GPF_OFFSITE_LOCAL=/var/tmp/gpft/offsite
source "${HERE}/../lib.sh"
set +e

fail=0
live_state() {
  docker inspect -f '{{.Name}} {{.State.StartedAt}}' pool-service-api-1 pool-service-mongo-1 pool-service-ntfy-1
  ( source "${LIVE}/deploy/lib.sh"; record_counts )
}
node_() { docker run --rm --network host -v "${HERE}:/t:ro" -v "${GPF_ROOT}:${GPF_ROOT}:ro" node:22 node /t/import-roundtrip.cjs "$@"; }
step() { echo "  \$ $*"; "$@" > /var/tmp/gpft-rt.log 2>&1 || { echo "  FAIL  $*"; tail -20 /var/tmp/gpft-rt.log | sed 's/^/        /'; fail=1; }; }

[[ -e "${GPF_ROOT}/tenants" ]] && { echo "Old test data; run: bash ${HERE}/run.sh --clean"; exit 1; }
LIVE_BEFORE="$(live_state)"
echo "== Setup (image $(current_image))"
step bash "${GPF}" edge-up
step bash "${GPF}" create alpha
step bash "${GPF}" create bravo
(( fail == 0 )) || { bash "${HERE}/run.sh" --clean >/dev/null; exit 1; }

echo "== Fill alpha, export it"
node_ seed "${GPF_EDGE_BIND}" alpha.gpf.test "$(cat "$(t_sec alpha)/owner-password")" || fail=1
step bash "${GPF}" export alpha
xlsx="$(ls -1 "$(t_dir alpha)"/exports/*/everything.xlsx | tail -1)"
echo "  export: ${xlsx}"

echo "== Import into bravo"
node_ import "${GPF_EDGE_BIND}" bravo.gpf.test "$(cat "$(t_sec bravo)/owner-password")" "${xlsx}" alpha.gpf.test "$(cat "$(t_sec alpha)/owner-password")" || fail=1

echo "== Clean up"
bash "${HERE}/run.sh" --clean
LIVE_AFTER="$(live_state)"
if [[ "${LIVE_BEFORE}" == "${LIVE_AFTER}" ]]; then echo "  PASS  live app untouched (same start times and record counts)"; else echo "  FAIL  live app changed"; fail=1; fi
echo "${LIVE_AFTER}" | tail -1 | sed 's/^/  /'
(( fail == 0 )) && echo "ROUND TRIP PASSED" || echo "ROUND TRIP FAILED"
(( fail == 0 ))
