#!/usr/bin/env bash
# Great Pool Friend tenant kit: one stack per business. See gpf/README.md.
#
#   tenant.sh build                      build the app image from pool-service/ (tag = git commit)
#   tenant.sh use-image <image>          the image new and updated tenants get
#   tenant.sh edge-up                    start/refresh Traefik, its Docker proxy and the notice page
#   tenant.sh create <name> [owner-email]   new business: secrets, folders, sealed network, database users,
#                                        route <name>.<domain>, backup key; the owner's login (their email,
#                                        else "owner") with a temporary password saved to a file
#   tenant.sh list                       every tenant: state, health, techs this month, image, last backup
#   tenant.sh users <name> [YYYY-MM]     its logins, and who was active that month
#   tenant.sh billing [YYYY-MM]          active techs and the monthly price per tenant (graduated tiers)
#   tenant.sh owner-password <name>      new temporary password for its first owner (saved to the file)
#   tenant.sh update <name|all> [image]  backup, counts, new image, health, counts again (stops on failure)
#   tenant.sh backup <name|all> [--predeploy]   database dump; nightly runs also send it and photos offsite
#   tenant.sh restore-check <name> [--offsite local|r2]   restore into a scratch database and compare
#   tenant.sh restore-check all --offsite [local|r2]      every tenant (the weekly cron job)
#   tenant.sh monitor health|backups|disk|test   alerts through ntfy (see monitor.sh)
#   tenant.sh cron [--install]           the cron lines for nightly backups, restore checks and alerts
#   tenant.sh welcome <name>             PDFs for a new business: its welcome guide (address, login) and
#                                        the beta tester guide, in tenants/<name>/docs/ (password not included)
#   tenant.sh feedback <name|all> [days] beta feedback its users sent (default: last 14 days)
#   tenant.sh errors <name|all> [days]   errors the app reported from phones (default: last 7 days)
#   tenant.sh export <name>              Excel "export everything" + photos.zip, for the customer
#   tenant.sh suspend|resume <name>      app offline behind a "paused" notice (503); data and backups untouched
#   tenant.sh delete <name> --confirm <name>    needs an export from the last 24 h; keeps a final backup
#   tenant.sh purge <name-time> --confirm <name-time>   after GPF_PURGE_DAYS (90): removes that final backup
#
# Settings come from the environment (see lib.sh), e.g. GPF_DOMAIN, GPF_ROOT, GPF_CONFIG.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

rand_hex() { openssl rand -hex "$1"; }
rand_pw() { openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | cut -c1-"$1"; }
need_image() { [[ -n "$(current_image)" ]] || die "No image chosen: run '$0 build' or '$0 use-image <image>'"; }
need_domain() { [[ -n "${GPF_DOMAIN}" ]] || die "Set GPF_DOMAIN (tenant address = <name>.<GPF_DOMAIN>)"; }

# ---- build / use-image
cmd_build() {
  local sha; sha="$(git -C "${REPO_DIR}" rev-parse --short HEAD)"
  if [[ -n "$(git -C "${REPO_DIR}" status --porcelain -- pool-service)" ]]; then
    die "pool-service/ has uncommitted changes; commit first so the image tag means one exact version"
  fi
  say "Building ${API_REPO}:${sha}"
  docker_ build -f "${APP_SRC}/server/Dockerfile" -t "${API_REPO}:${sha}" "${APP_SRC}"
  cmd_use_image "${API_REPO}:${sha}"
}
cmd_use_image() {
  [[ -n "${1:-}" ]] || die "Give an image"
  docker_ image inspect "$1" >/dev/null 2>&1 || die "No image $1 on this machine"
  mkdir -p "${GPF_CONFIG}" && chmod 700 "${GPF_CONFIG}"
  echo "$1" > "${GPF_CONFIG}/current-image"
  echo "New and updated tenants get: $1"
}

# ---- edge
edge_connect() {
  local net; net="$(t_net "$1")"
  docker_ network inspect "${net}" >/dev/null 2>&1 || return 0
  if ! docker_ inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "${TRAEFIK}" | grep -qw "${net}"; then
    docker_ network connect "${net}" "${TRAEFIK}"
  fi
}
edge_disconnect() {
  local net; net="$(t_net "$1")"
  docker_ network disconnect "${net}" "${TRAEFIK}" >/dev/null 2>&1 || true
}
cmd_edge_up() {
  need_image
  mkdir -p "${GPF_CONFIG}/edge/dynamic"
  chmod 700 "${GPF_CONFIG}"
  say "Starting the edge (Traefik on ${GPF_EDGE_BIND})"
  edc up -d --wait
  local t; for t in $(tenants); do edge_connect "${t}"; done
}
edge_running() { [[ "$(docker_ inspect -f '{{.State.Running}}' "${TRAEFIK}" 2>/dev/null)" == true ]]; }

# ---- create
next_subnet() {
  local used n o3 o4 s
  used="$( { for t in $(tenants); do t_get "${t}" SUBNET; done
             docker_ network inspect $(docker_ network ls -q) -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}' 2>/dev/null | tr ' ' '\n'; } | sort -u)"
  for n in $(seq 0 2047); do
    o3=$((n / 8)); o4=$(((n % 8) * 32))
    s="${GPF_SUBNET_BASE}.${o3}.${o4}/27"
    grep -qxF "${s}" <<<"${used}" || { echo "${s}"; return 0; }
  done
  die "No free tenant subnet in ${GPF_SUBNET_BASE}.0.0/16"
}
cmd_create() {
  local name="${1:-}" owner_email="${2:-owner}"; need_name "${name}"; need_domain; need_image
  owner_email="${owner_email,,}"
  [[ "${owner_email}" == owner || "${owner_email}" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || die "The owner's login must be an email address"
  t_exists "${name}" && die "Tenant ${name} already exists"
  edge_running || die "The edge isn't running: '$0 edge-up' first"
  local sec dir image subnet
  sec="$(t_sec "${name}")"; dir="$(t_dir "${name}")"; image="$(current_image)"
  [[ -e "${dir}" ]] && die "${dir} already exists; refusing to reuse old data"
  subnet="$(next_subnet)"

  say "Creating tenant ${name} (${name}.${GPF_DOMAIN}, network ${subnet})"
  mkdir -p "${GPF_CONFIG}/tenants" && chmod 700 "${GPF_CONFIG}" "${GPF_CONFIG}/tenants"
  ( umask 077
    mkdir -p "${sec}"
    rand_hex 24 > "${sec}/mongo-root-password"
    rand_hex 24 > "${sec}/mongo-app-password"
    openssl rand -base64 756 > "${sec}/mongo-keyfile"
    openssl rand -base64 32 > "${sec}/restic-password"
    rand_pw 16 > "${sec}/owner-password"
    local hash
    hash="$(tr -d '\n' < "${sec}/owner-password" | docker_ run --rm -i "${image}" node server/dist/cli/hash-password.js -)"
    [[ "${hash}" == '$argon2'* ]] || die "Password hashing failed"
    cat > "${sec}/api.env" <<ENV
# tenant ${name}, made by gpf/tenant.sh create on $(now). Keep private.
ADMIN_PASSWORD_HASH='${hash}'
SESSION_SECRET=$(rand_hex 32)
MONGO_URL=mongodb://app:$(cat "${sec}/mongo-app-password")@mongo:27017/pool?replicaSet=rs0&authSource=pool
LOG_LEVEL=info
OWNER_EMAIL=${owner_email}
ENV
    cat > "${sec}/compose.env" <<ENV
TENANT=${name}
GPF_PREFIX=${GPF_PREFIX}
DOMAIN=${GPF_DOMAIN}
IMAGE=${image}
SUBNET=${subnet}
DATA_DIR=${dir}/data
SECRETS_DIR=${sec}
STATE=active
CREATED=$(now)
ENV
  )
  mkdir -p "${dir}/data/mongo" "${dir}/data/photos" "${dir}/backups" "${dir}/exports"
  # The app runs as uid 1000 ("node") in its image.
  docker_ run --rm -v "${dir}/data/photos:/p" "${HELPER_IMAGE}" chown 1000:1000 /p

  say "Starting ${name}"
  tdc "${name}" up -d
  edge_connect "${name}"
  t_wait_healthy "${name}"
  local code; code="$(t_edge_code "${name}")"
  [[ "${code}" == 200 ]] || die "${name}.${GPF_DOMAIN} answers ${code} through the edge"
  # The app made the owner's login on its first start; they choose their own password at the first login.
  tr -d '\n' < "${sec}/owner-password" | t_users "${name}" set-password --temporary >/dev/null || die "Could not mark ${name}'s owner password as temporary"

  local target
  for target in $(offsite_targets); do
    say "Setting up the ${target} offsite copy (encrypted with ${name}'s own key)"
    trestic "${name}" "${target}" -- init --quiet || die "Could not set up the ${target} backup repository"
  done
  cat <<MSG

Tenant ${name} is running: https://${name}.${GPF_DOMAIN}
  Owner login: ${owner_email}
  Temporary password: in ${sec}/owner-password (give it to the owner; they choose their own at the first login)
  Encryption key for its backups: ${sec}/restic-password (keep a copy off this server)
MSG
}

# ---- list, users, billing, owner password
# The app's users CLI: in the running app, or (suspended) a one-off copy that Traefik ignores.
t_users() {
  local name="$1"; shift
  if [[ "$(t_health "${name}")" == healthy ]]; then
    tdc "${name}" exec -T api node server/dist/cli/users.js "$@" 2>/dev/null
  else
    tdc "${name}" run --rm -T --no-deps -l traefik.enable=false api node server/dist/cli/users.js "$@" 2>/dev/null
  fi
}
this_month() { date -u +%Y-%m; }
cmd_list() {
  printf '%-20s %-10s %-10s %-6s %-22s %s\n' TENANT STATE HEALTH TECHS LAST_BACKUP IMAGE
  local t
  for t in $(tenants); do
    printf '%-20s %-10s %-10s %-6s %-22s %s\n' "${t}" "$(t_get "${t}" STATE)" "$(t_health "${t}")" "$(t_users "${t}" techs "$(this_month)" || echo '?')" \
      "$(cat "$(t_dir "${t}")/backups/LAST_BACKUP" 2>/dev/null || echo never)" "$(t_get "${t}" IMAGE)"
  done
}
cmd_users() {
  local name="${1:-}" month="${2:-$(this_month)}"; need_tenant "${name}"
  [[ "${month}" =~ ^[0-9]{4}-[0-9]{2}$ ]] || die "Month as YYYY-MM"
  t_users "${name}" table "${month}" || die "Could not read ${name}'s logins"
}
# Monthly price for n active techs: $75 covers 1-3, then each extra tech at its tier's rate.
price_for() {
  local n="$1" total=75 i
  for ((i = 4; i <= n; i++)); do
    if ((i <= 5)); then total=$((total + 20)); elif ((i <= 15)); then total=$((total + 18)); elif ((i <= 30)); then total=$((total + 15))
    elif ((i <= 50)); then total=$((total + 12)); elif ((i <= 75)); then total=$((total + 10)); else total=$((total + 8)); fi
  done
  echo "${total}"
}
cmd_billing() {
  local month="${1:-$(this_month)}" t n p sum=0
  [[ "${month}" =~ ^[0-9]{4}-[0-9]{2}$ ]] || die "Month as YYYY-MM"
  printf '%-20s %-10s %6s %8s\n' TENANT STATE TECHS PRICE
  for t in $(tenants); do
    n="$(t_users "${t}" techs "${month}")" || die "Could not count ${t}'s techs"
    p="$(price_for "${n}")"
    sum=$((sum + p))
    printf '%-20s %-10s %6s %8s\n' "${t}" "$(t_get "${t}" STATE)" "${n}" "\$${p}"
  done
  printf '%-20s %-10s %6s %8s\n' TOTAL "" "" "\$${sum}"
  echo "(${month}: a tech counts if their login was used that month; owners are free; \$75 covers up to 3 techs)"
}
cmd_owner_password() {
  local name="${1:-}"; need_tenant "${name}"
  local sec; sec="$(t_sec "${name}")"
  ( umask 077; rand_pw 16 > "${sec}/owner-password.new" )
  tr -d '\n' < "${sec}/owner-password.new" | t_users "${name}" set-password --temporary >/dev/null || die "Could not set ${name}'s owner password"
  mv "${sec}/owner-password.new" "${sec}/owner-password"
  echo "${name}: new temporary owner password in ${sec}/owner-password (the owner's devices are signed out)"
}

# each <fn> <name|all> args…: runs fn per tenant. A failure stops everything (set -e), so with
# "all" the tenants after a failing one are not touched. Never call these functions with || or &&:
# bash turns set -e off inside them then.
each() {
  local fn="$1" which="${2:-}"; shift 2 || true
  if [[ "${which}" == all ]]; then
    local t; for t in $(tenants); do say "tenant ${t}"; "${fn}" "${t}" "$@"; done
  else
    need_tenant "${which}"; "${fn}" "${which}" "$@"
  fi
}
# Like each, but keeps going (nightly backups: one tenant's failure mustn't skip the others).
each_continue() {
  local fn="$1" which="${2:-}" failed=() rc t; shift 2 || true
  local list; if [[ "${which}" == all ]]; then list="$(tenants)"; else need_tenant "${which}"; list="${which}"; fi
  for t in ${list}; do
    set +e; ( set -e; "${fn}" "${t}" "$@" ); rc=$?; set -e
    (( rc == 0 )) || failed+=("${t}")
  done
  (( ${#failed[@]} == 0 )) || die "Failed: ${failed[*]}"
}

# ---- backup
backup_one() {
  local name="$1" label="${2:-}" dir ts out keep pattern
  dir="$(t_dir "${name}")"; ts="$(date -u +%Y%m%d-%H%M%S)"
  case "${label}" in
    --predeploy) out="${dir}/backups/pool-predeploy-${ts}.archive.gz"; keep=10; pattern="pool-predeploy-*.archive.gz" ;;
    --final)     out="${dir}/backups/pool-final-${ts}.archive.gz"; keep=0; pattern="" ;;
    "")          out="${dir}/backups/pool-${ts}.archive.gz"; keep=14; pattern="pool-2*.archive.gz" ;;
    *) die "Unknown backup option ${label}" ;;
  esac
  tjob "${name}" -- sh -c 'mongodump --quiet --host mongo -u root -p "$(cat /run/secrets/mongo_root_password)" --authenticationDatabase admin --db pool --archive --gzip' > "${out}.part"
  [[ -s "${out}.part" ]] || { rm -f "${out}.part"; die "Backup of ${name} is empty"; }
  mv "${out}.part" "${out}"
  if [[ -n "${pattern}" ]]; then
    # shellcheck disable=SC2012
    ls -1t "${dir}/backups/"${pattern} 2>/dev/null | tail -n +$((keep + 1)) | xargs -r rm --
  fi
  now > "${dir}/backups/LAST_BACKUP"
  echo "${name}: backup written: ${out} ($(du -h "${out}" | cut -f1))"
  [[ "${label}" == --predeploy ]] && return 0

  local target tag=nightly failed=0
  [[ "${label}" == --final ]] && tag=final
  for target in $(offsite_targets); do
    if trestic "${name}" "${target}" -v "${out}:/data/db.archive.gz:ro" -v "${dir}/data/photos:/data/photos:ro" -- \
         backup --quiet --host "${name}" --tag "${tag}" /data/db.archive.gz /data/photos &&
       { [[ "${tag}" == final ]] || trestic "${name}" "${target}" -- forget --quiet --host "${name}" --tag nightly \
           --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune; }; then
      echo "${name}: offsite copy (${target}) sent: database + $(find "${dir}/data/photos" -type f | wc -l) photo files"
    else
      echo "${name}: OFFSITE BACKUP (${target}) FAILED $(now); the local backup ${out} is fine" >&2
      failed=1
    fi
  done
  (( failed == 0 )) || return 2
  [[ -n "$(offsite_targets)" ]] && now > "${dir}/backups/LAST_OFFSITE"
  return 0
}
cmd_backup() { each_continue backup_one "$@"; }

# ---- restore-check
restore_into_scratch() {
  tjob "$1" -- sh -c 'mongorestore --quiet --host mongo -u root -p "$(cat /run/secrets/mongo_root_password)" --authenticationDatabase admin --archive --gzip --nsFrom "pool.*" --nsTo "pool_restorecheck.*"'
}
# restore-check all --offsite: every tenant, every offsite target; keeps going past a failure.
cmd_restore_check() {
  if [[ "${1:-}" == all ]]; then
    [[ "${2:-}" == --offsite ]] || die "Use: restore-check all --offsite [local|r2]"
    local targets="${3:-$(offsite_targets)}"
    [[ -n "${targets}" ]] || die "No offsite copy is set up"
    local t target failed=()
    for t in $(tenants); do for target in ${targets}; do
      set +e; ( set -e; restore_check_one "${t}" --offsite "${target}" ); local rc=$?; set -e
      (( rc == 0 )) || failed+=("${t}/${target}")
    done; done
    (( ${#failed[@]} == 0 )) || die "Restore check failed: ${failed[*]}"
    return 0
  fi
  restore_check_one "$@"
}
restore_check_one() {
  local name="${1:-}" opt="${2:-}" target="${3:-}"; need_tenant "${name}"
  local dir; dir="$(t_dir "${name}")"
  tmongosh "${name}" pool_restorecheck <<<'db.dropDatabase()' >/dev/null
  local what
  if [[ "${opt}" == --offsite ]]; then
    [[ "${target}" == local || "${target}" == r2 ]] || die "--offsite local or --offsite r2"
    offsite_targets | grep -qx "${target}" || die "No ${target} offsite copy is set up"
    what="the newest ${target} offsite copy"
    say "${name}: reading every byte of the ${target} copy"
    trestic "${name}" "${target}" -- check --read-data --quiet || die "The ${target} copy of ${name} is damaged or unreadable"
    say "${name}: restoring ${what} into a scratch database"
    trestic "${name}" "${target}" -- dump latest /data/db.archive.gz | restore_into_scratch "${name}"
  else
    what="$(ls -1t "${dir}"/backups/pool-*.archive.gz 2>/dev/null | head -1)"
    [[ -n "${what}" && -s "${what}" ]] || die "No backup of ${name} yet"
    say "${name}: restoring ${what} into a scratch database"
    restore_into_scratch "${name}" < "${what}"
  fi
  local restored live
  restored="$(t_counts "${name}" pool_restorecheck)"
  live="$(t_counts "${name}")"
  tmongosh "${name}" pool_restorecheck <<<'db.dropDatabase()' >/dev/null
  say "${name}: backup vs live (live can be higher if records were added since)"
  compare_counts "${restored}" "${live}" backup live || die "${name}: the live database has fewer records than the backup!"
  [[ "${opt}" == --offsite ]] && now > "${dir}/backups/LAST_RESTORE_CHECK"
  echo "${name}: restore check passed (${what})"
}

# ---- cron: nightly backups, weekly restore checks, alerts. --install puts them in this user's
# crontab between marker lines (replacing an earlier copy); other lines are left alone.
cron_lines() {
  local kit; kit="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local env="GPF_PREFIX=${GPF_PREFIX} GPF_ROOT=${GPF_ROOT} GPF_CONFIG=${GPF_CONFIG}"
  local log="${GPF_ROOT}/logs"
  echo "# ${GPF_PREFIX}-kit begin (tenant.sh cron --install; remove both marker lines and what's between to stop)"
  echo "37 2 * * * ${env} bash ${kit}/tenant.sh backup all >> ${log}/backup.log 2>&1"
  [[ -n "$(offsite_targets)" ]] && echo "13 5 * * 0 ${env} bash ${kit}/tenant.sh restore-check all --offsite >> ${log}/restore-check.log 2>&1"
  echo "*/5 * * * * ${env} bash ${kit}/monitor.sh health >> ${log}/monitor.log 2>&1"
  echo "23 * * * * ${env} bash ${kit}/monitor.sh disk >> ${log}/monitor.log 2>&1"
  echo "41 6 * * * ${env} bash ${kit}/monitor.sh backups >> ${log}/monitor.log 2>&1"
  echo "53 * * * * ${env} bash ${kit}/monitor.sh feedback >> ${log}/monitor.log 2>&1"
  echo "# ${GPF_PREFIX}-kit end"
}
cmd_cron() {
  if [[ "${1:-}" != --install ]]; then cron_lines; return 0; fi
  mkdir -p "${GPF_ROOT}/logs"
  local current; current="$(crontab -l 2>/dev/null || true)"
  { [[ -n "${current}" ]] && printf '%s\n' "${current}" | sed "/^# ${GPF_PREFIX}-kit begin/,/^# ${GPF_PREFIX}-kit end/d"; cron_lines; } | crontab -
  echo "Cron jobs installed for ${GPF_PREFIX} (crontab -l to see them)"
}

# ---- beta: the welcome guide and tester guide as PDFs (gpf/docs/*.md → Playwright's Chromium)
make_pdf() { # make_pdf <doc.md> <out.pdf> [KEY=value…]
  local md="$1" out="$2"; shift 2
  mkdir -p "${GPF_ROOT}/.pdf-node" "$(dirname "${out}")"
  docker_ run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "${GPF_DIR}/docs:/docs:ro" -v "${GPF_ROOT}/.pdf-node:/pdfnode" \
    -v "$(dirname "${out}"):/out" "${PLAYWRIGHT_IMAGE}" bash -c '
      [ -d /pdfnode/node_modules/playwright ] || (cd /pdfnode && npm i -s --no-audit --no-fund playwright@1.56.1 >/dev/null)
      NODE_PATH=/pdfnode/node_modules node /docs/make-pdf.cjs "/docs/$1" "/out/$2" "${@:3}"' _ "${md}" "$(basename "${out}")" "$@"
}
cmd_welcome() {
  local name="${1:-}"; need_tenant "${name}"
  local login business docs
  login="$(sed -n 's/^OWNER_EMAIL=//p' "$(t_sec "${name}")/api.env" 2>/dev/null | tail -1)"
  business="$(tmongosh "${name}" pool <<<"(db.settings.findOne({ businessName: { \$nin: [null, ''] } }) || {}).businessName || ''" 2>/dev/null || true)"
  docs="$(t_dir "${name}")/docs"
  make_pdf welcome-owner.md "${docs}/welcome-${name}.pdf" "BUSINESS=${business:-your business}" \
    "ADDRESS=https://${name}.${GPF_DOMAIN}" "LOGIN=${login:-owner}" "SUPPORT=Questions or problems: ${GPF_SUPPORT_EMAIL}, or More → Send feedback in the app."
  make_pdf beta-tester-guide.md "${docs}/beta-tester-guide.pdf" "SUPPORT=${GPF_SUPPORT_EMAIL}, or More → Send feedback in the app."
  echo "${name}: welcome guide and tester guide in ${docs}/ (send the temporary password separately)"
}

# ---- beta: feedback and app errors, read from each tenant's database (read only)
feedback_one() {
  local name="$1" days="${2:-14}"
  echo "== ${name}"
  tmongosh "${name}" pool <<<"
    const since = new Date(Date.now() - ${days} * 864e5);
    const rows = db.feedback.find({ createdAt: { \$gte: since } }).sort({ createdAt: -1 }).toArray();
    if (!rows.length) print('  (none in ${days} days)');
    for (const f of rows) print('  ' + f.createdAt.toISOString().slice(0, 16).replace('T', ' ') + '  ' + (f.kind || '') + '  ' + (f.userName || '?') + ' (' + (f.role || '') + ')  ' + (f.screen || '') + '  v' + (f.appVersion || '?') + '  ' + (f.language || '') + (f.doneAt ? '  [done]' : '') + '\n    ' + f.text.replace(/\n/g, '\n    '));"
}
errors_one() {
  local name="$1" days="${2:-7}"
  echo "== ${name}"
  tmongosh "${name}" pool <<<"
    const since = new Date(Date.now() - ${days} * 864e5);
    const rows = db.clientErrors.find({ lastAt: { \$gte: since } }).sort({ count: -1 }).toArray();
    if (!rows.length) print('  (none in ${days} days)');
    for (const e of rows) print('  ' + String(e.count).padStart(4) + 'x  v' + (e.appVersion || '?') + '  ' + e.where + '  ' + (e.screen || '') + '  last ' + e.lastAt.toISOString().slice(0, 16).replace('T', ' ') + '\n        ' + e.message + (e.stack ? '\n        ' + e.stack.split('\n').slice(0, 3).join('\n        ') : ''));"
}
cmd_feedback() { local which="${1:-}"; shift || true; each feedback_one "${which}" "$@"; }
cmd_errors() { local which="${1:-}"; shift || true; each errors_one "${which}" "$@"; }

# ---- update
update_one() {
  local name="$1" image="${2:-$(current_image)}"
  [[ -n "${image}" ]] || die "No image chosen"
  [[ "$(t_get "${name}" STATE)" == active ]] || { echo "${name}: suspended, image set for when it resumes"; t_set "${name}" IMAGE "${image}"; return 0; }
  say "${name}: safety backup"
  backup_one "${name}" --predeploy   # stops here on failure; nothing changed yet
  local before after old
  before="$(t_counts "${name}")"
  old="$(t_get "${name}" IMAGE)"
  say "${name}: ${old} -> ${image}"
  t_set "${name}" IMAGE "${image}"
  tdc "${name}" up -d
  edge_connect "${name}"
  t_wait_healthy "${name}"
  after="$(t_counts "${name}")"
  if ! compare_counts "${before}" "${after}"; then
    local latest; latest="$(ls -1t "$(t_dir "${name}")"/backups/pool-predeploy-*.archive.gz | head -1)"
    die "${name}: records missing after the update. Backup kept: ${latest}. Previous image: ${old}"
  fi
  [[ "$(t_edge_code "${name}")" == 200 ]] || die "${name}: not reachable through the edge after the update"
  echo "${name}: updated; all records accounted for"
}
cmd_update() { local which="${1:-}"; shift || true; each update_one "${which}" "$@"; }

# ---- export
cmd_export() {
  local name="${1:-}"; need_tenant "${name}"
  local dir out was_suspended=0
  dir="$(t_dir "${name}")"; out="${dir}/exports/$(date -u +%Y%m%d-%H%M%S)"
  mkdir -p "${out}"
  if [[ "$(t_get "${name}" STATE)" == suspended ]]; then
    # The notice route keeps answering visitors; the app starts only for this export.
    was_suspended=1; tdc "${name}" up -d api; t_wait_healthy "${name}"
  fi
  say "${name}: export everything (Excel)"
  local session
  session="$(tdc "${name}" exec -T api node server/dist/cli/e2e-session.js)"
  printf '%s' "${session}" | tdc "${name}" exec -T api node -e "
    let s = ''; process.stdin.on('data', (d) => (s += d)).on('end', async () => {
      const r = await fetch('http://127.0.0.1:3000/api/export/everything.xlsx?tzOffsetMin=0', { headers: { cookie: 'pool.sid=' + s } });
      if (!r.ok) { console.error('export answered ' + r.status); process.exit(1); }
      process.stdout.write(Buffer.from(await r.arrayBuffer()));
    });" > "${out}/everything.xlsx"
  unset session
  [[ -s "${out}/everything.xlsx" ]] || die "Empty export"
  say "${name}: photos"
  ( cd "${dir}/data" && zip -qr "${out}/photos.zip" photos )
  (( was_suspended )) && tdc "${name}" stop api
  now > "${out}/EXPORT_DONE"
  echo "${name}: export ready in ${out} (everything.xlsx $(du -h "${out}/everything.xlsx" | cut -f1), photos.zip $(du -h "${out}/photos.zip" | cut -f1))"
}

# ---- suspend / resume
notice_file() { echo "${GPF_CONFIG}/edge/dynamic/${GPF_PREFIX}-$1.yml"; }
cmd_suspend() {
  local name="${1:-}"; need_tenant "${name}"
  cat > "$(notice_file "${name}")" <<YML
# ${name} suspended $(now) by tenant.sh; removed by tenant.sh resume
http:
  routers:
    ${GPF_PREFIX}-${name}-paused:
      rule: Host(\`${name}.${GPF_DOMAIN}\`)
      entryPoints: [web]
      priority: 100000
      service: ${GPF_PREFIX}-notice
  services:
    ${GPF_PREFIX}-notice:
      loadBalancer:
        servers:
          - url: http://${GPF_PREFIX}-notice:8080
YML
  t_set "${name}" STATE suspended
  for _ in $(seq 1 20); do [[ "$(t_http "${name}" /api/health)" == 503 ]] && break; sleep 1; done
  tdc "${name}" stop api
  echo "${name}: suspended (answers 503 'paused'; database, data and backups untouched)"
}
cmd_resume() {
  local name="${1:-}"; need_tenant "${name}"
  t_set "${name}" STATE active
  tdc "${name}" up -d
  edge_connect "${name}"
  t_wait_healthy "${name}"
  rm -f "$(notice_file "${name}")"
  for _ in $(seq 1 20); do [[ "$(t_http "${name}" /api/health)" == 200 ]] && break; sleep 1; done
  [[ "$(t_http "${name}" /api/health)" == 200 ]] || die "${name} isn't answering after resume"
  echo "${name}: resumed"
}

# ---- delete / purge
confirm() { # confirm <expected> <given>
  local given="${2:-}"
  if [[ -z "${given}" ]]; then read -rp "Type '$1' to confirm: " given < /dev/tty; fi
  [[ "${given}" == "$1" ]] || die "Not confirmed; nothing was changed"
}
cmd_delete() {
  local name="${1:-}"; need_tenant "${name}"
  [[ "${2:-}" == --confirm ]] && local given="${3:-}"
  local dir sec recent stamp
  dir="$(t_dir "${name}")"; sec="$(t_sec "${name}")"
  recent="$(find "${dir}/exports" -name EXPORT_DONE -mmin -1440 | head -1)"
  [[ -n "${recent}" ]] || die "No export of ${name} in the last 24 hours: run '$0 export ${name}' and send it to the customer first"
  confirm "${name}" "${given:-}"
  [[ "$(t_get "${name}" STATE)" == active ]] || { tdc "${name}" up -d api; t_wait_healthy "${name}"; }
  say "${name}: final backup (kept ${GPF_PURGE_DAYS} days)"
  local rc; set +e; ( set -e; backup_one "${name}" --final ); rc=$?; set -e
  (( rc == 0 )) || die "${name}: the final backup failed; nothing was deleted"
  say "${name}: stopping and removing its containers and network"
  stamp="${name}-$(date -u +%Y%m%d-%H%M%S)"
  rm -f "$(notice_file "${name}")"
  edge_disconnect "${name}"
  tdc "${name}" down
  mkdir -p "${GPF_ROOT}/deleted" "${GPF_CONFIG}/deleted" && chmod 700 "${GPF_CONFIG}/deleted"
  mv "${dir}" "${GPF_ROOT}/deleted/${stamp}"
  # Live database files and photos go; the final dump, older dumps, exports and offsite copies stay.
  docker_ run --rm -v "${GPF_ROOT}/deleted/${stamp}:/t" "${HELPER_IMAGE}" rm -rf /t/data
  mv "${sec}" "${GPF_CONFIG}/deleted/${stamp}"
  now > "${GPF_CONFIG}/deleted/${stamp}/DELETED_AT"
  echo "${name}: deleted. Kept until purge (${GPF_PURGE_DAYS} days): ${GPF_ROOT}/deleted/${stamp} and its offsite copies (key in ${GPF_CONFIG}/deleted/${stamp})"
}
cmd_purge() {
  local stamp="${1:-}"
  [[ -n "${stamp}" && -f "${GPF_CONFIG}/deleted/${stamp}/DELETED_AT" ]] || die "No deleted tenant ${stamp} (see ${GPF_CONFIG}/deleted/)"
  [[ "${2:-}" == --confirm ]] && local given="${3:-}"
  local deleted_at age_days name
  deleted_at="$(cat "${GPF_CONFIG}/deleted/${stamp}/DELETED_AT")"
  age_days=$(( ($(date -u +%s) - $(date -u -d "${deleted_at}" +%s)) / 86400 ))
  (( age_days >= GPF_PURGE_DAYS )) || die "${stamp} was deleted ${age_days} days ago; purge is allowed after ${GPF_PURGE_DAYS}"
  confirm "${stamp}" "${given:-}"
  name="${stamp%-*-*}"
  local target ids
  for target in $(offsite_targets); do
    say "${stamp}: removing the ${target} offsite copies"
    ids="$(TRESTIC_KEY="${GPF_CONFIG}/deleted/${stamp}/restic-password" trestic "${name}" "${target}" -- snapshots --json --host "${name}" | grep -o '"short_id":"[^"]*"' | cut -d'"' -f4 || true)"
    if [[ -n "${ids}" ]]; then
      # shellcheck disable=SC2086
      TRESTIC_KEY="${GPF_CONFIG}/deleted/${stamp}/restic-password" trestic "${name}" "${target}" -- forget --quiet --prune ${ids}
    fi
    [[ "${target}" == local ]] && rm -rf "${GPF_OFFSITE_LOCAL:?}/${name}"
  done
  rm -rf "${GPF_ROOT:?}/deleted/${stamp}" "${GPF_CONFIG:?}/deleted/${stamp}"
  echo "${stamp}: purged"
}

case "${1:-}" in
  build) cmd_build ;;
  use-image) cmd_use_image "${2:-}" ;;
  edge-up) cmd_edge_up ;;
  create) cmd_create "${2:-}" "${3:-}" ;;
  list) cmd_list ;;
  users) cmd_users "${2:-}" "${3:-}" ;;
  billing) cmd_billing "${2:-}" ;;
  owner-password) cmd_owner_password "${2:-}" ;;
  update) shift; cmd_update "$@" ;;
  backup) shift; cmd_backup "$@" ;;
  restore-check) shift; cmd_restore_check "$@" ;;
  monitor) shift; bash "$(dirname "${BASH_SOURCE[0]}")/monitor.sh" "$@" ;;
  cron) cmd_cron "${2:-}" ;;
  welcome) cmd_welcome "${2:-}" ;;
  feedback) shift; cmd_feedback "$@" ;;
  errors) shift; cmd_errors "$@" ;;
  export) cmd_export "${2:-}" ;;
  suspend) cmd_suspend "${2:-}" ;;
  resume) cmd_resume "${2:-}" ;;
  delete) shift; cmd_delete "$@" ;;
  purge) shift; cmd_purge "$@" ;;
  *) sed -n '2,/^# Settings/p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
