#!/usr/bin/env bash
# Great Pool Friend: alerts for every tenant (business), through ntfy. One alert when a problem
# starts, one "OK again" when it ends. Usually run from cron via tenant.sh (see "tenant.sh cron"):
#
#   monitor.sh health     every 5 min: each active tenant's /api/health through the edge (as a
#                         visitor arrives); alerts after 2 failures in a row. If the edge itself is
#                         down, one "edge down" alert instead of one per tenant. Suspended tenants are skipped.
#   monitor.sh backups    daily: per tenant, alerts if the nightly backup or its offsite copy is over
#                         26 h old, or the weekly offsite restore check hasn't passed in 8 days
#   monitor.sh disk       hourly: alerts when the disk holding GPF_ROOT is over GPF_DISK_LIMIT % (80)
#   monitor.sh feedback   hourly: one alert per tenant with new beta feedback since the last check
#   monitor.sh audit      monthly: known security holes in the app's packages (npm audit); alerts on
#                         high or critical ones (moderate ones are listed in the log only)
#   monitor.sh test       sends a test alert
#
# Alerts go to GPF_NTFY_URL (e.g. http://127.0.0.1:2586/gpf-alerts) with the token in the file
# GPF_NTFY_TOKEN_FILE (optional). Without GPF_NTFY_URL they are only written to the log.
# Each tenant's backups/MONITOR_STATUS is written too, so its System card shows open alerts.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

STATE="${GPF_ROOT}/monitor"
GPF_NTFY_URL="${GPF_NTFY_URL:-}"
GPF_NTFY_TOKEN_FILE="${GPF_NTFY_TOKEN_FILE:-}"
GPF_DISK_LIMIT="${GPF_DISK_LIMIT:-80}"
mkdir -p "${STATE}"

# notify <title> <message> [priority] [tags]
notify() {
  echo "$(now) ALERT $1: $2"
  [[ -n "${GPF_NTFY_URL}" ]] || return 0
  local auth=()
  [[ -n "${GPF_NTFY_TOKEN_FILE}" && -s "${GPF_NTFY_TOKEN_FILE}" ]] && auth=(-H "Authorization: Bearer $(cat "${GPF_NTFY_TOKEN_FILE}")")
  curl -fsS --max-time 20 -o /dev/null "${auth[@]}" -H "Title: $1" -H "Priority: ${3:-default}" \
    -H "Tags: ${4:-}" -d "$2" "${GPF_NTFY_URL}" || echo "$(now) could not send alert: $1" >&2
}
# problem <key> <title> <message>: alert once, when the problem starts
problem() {
  echo "$(now) PROBLEM $1: $3"
  [[ -e "${STATE}/$1.down" ]] && return 0
  now > "${STATE}/$1.down"
  notify "$2" "$3" high warning
}
# fine <key> <title>: "OK again" once, if there was a problem
fine() {
  [[ -e "${STATE}/$1.down" ]] || return 0
  local since; since="$(cat "${STATE}/$1.down")"
  rm -f "${STATE}/$1.down"
  echo "$(now) OK $1"
  notify "$2" "OK again (problem since ${since})" default white_check_mark
}
age_hours() { # file → hours since the timestamp inside it (999 if missing)
  [[ -s "$1" ]] || { echo 999; return; }
  echo $(( ($(date +%s) - $(date -d "$(cat "$1")" +%s)) / 3600 ))
}
ago() { # ago <hours> [word]: "last one 30 h ago", "last pass 9 days ago", "none yet"
  (( $1 >= 999 )) && { echo "none yet"; return; }
  if (( $1 >= 48 )); then echo "last ${2:-one} $(( $1 / 24 )) days ago"; else echo "last ${2:-one} $1 h ago"; fi
}
health_ok() { curl -s --max-time 15 -H "Host: $1.${GPF_DOMAIN}" "http://${GPF_EDGE_BIND}/api/health" 2>/dev/null | grep -q '"mongo":true'; }

check_health() {
  local t fails
  if ! edge_up; then
    fails=$(( $(cat "${STATE}/edge.fails" 2>/dev/null || echo 0) + 1 )); echo "${fails}" > "${STATE}/edge.fails"
    (( fails >= 2 )) && problem edge "GPF edge is DOWN" "Traefik isn't running, so no business can be reached. Run: tenant.sh edge-up"
    return 0
  fi
  rm -f "${STATE}/edge.fails"; fine edge "GPF edge is back up"
  for t in $(tenants); do
    if [[ "$(t_get "${t}" STATE)" != active ]]; then rm -f "${STATE}/${t}.health.fails" "${STATE}/${t}.health.down"; continue; fi
    if health_ok "${t}"; then
      rm -f "${STATE}/${t}.health.fails"; fine "${t}.health" "${t} is back up"; continue
    fi
    fails=$(( $(cat "${STATE}/${t}.health.fails" 2>/dev/null || echo 0) + 1 )); echo "${fails}" > "${STATE}/${t}.health.fails"
    (( fails >= 2 )) || continue
    local why="The app isn't running."
    case "$(t_health "${t}")" in
      healthy) why="The app runs but can't be reached through the edge, or its database isn't answering." ;;
      starting) why="The app is still starting." ;;
      unhealthy) why="The app is up but unhealthy (often: its database isn't answering)." ;;
    esac
    problem "${t}.health" "${t} is DOWN" "${why} Failing for $(( fails * 5 )) minutes. Logs: docker compose -p $(t_project "${t}") logs --tail 50"
  done
}
edge_up() { [[ "$(docker_ inspect -f '{{.State.Running}}' "${TRAEFIK}" 2>/dev/null)" == true ]]; }

check_backups() {
  local t dir issues b o r
  for t in $(tenants); do
    dir="$(t_dir "${t}")/backups"; issues=()
    b="$(age_hours "${dir}/LAST_BACKUP")"
    (( b <= 26 )) || issues+=("Nightly backup: $(ago "${b}").")
    if [[ -n "$(offsite_targets)" ]]; then
      o="$(age_hours "${dir}/LAST_OFFSITE")"
      (( o <= 26 )) || issues+=("Offsite copy: $(ago "${o}").")
      r="$(age_hours "${dir}/LAST_RESTORE_CHECK")"
      (( r <= 8 * 24 )) || issues+=("Weekly restore check: $(ago "${r}" pass).")
    fi
    if (( ${#issues[@]} )); then
      problem "${t}.backups" "${t}: backup problem" "${issues[*]} See ${GPF_ROOT}/logs/."
    else
      fine "${t}.backups" "${t}: backups OK"
    fi
  done
}

check_disk() {
  local used; used="$(df --output=pcent "${GPF_ROOT}" | tail -1 | tr -dc 0-9)"
  if (( used > GPF_DISK_LIMIT )); then
    problem disk "GPF server disk ${used}% full" "The disk holding ${GPF_ROOT} is ${used}% full (limit ${GPF_DISK_LIMIT}%). Backups and photos need space."
  else
    fine disk "GPF server disk OK (${used}% full)"
  fi
}

# New beta feedback: the newest note and how many arrived since the last check (state: <t>.feedback.seen).
check_feedback() {
  local t seen out n first
  for t in $(tenants); do
    seen="$(cat "${STATE}/${t}.feedback.seen" 2>/dev/null || echo 1970-01-01T00:00:00Z)"
    out="$(tmongosh "${t}" pool <<<"
      const rows = db.feedback.find({ createdAt: { \$gt: new Date('${seen}') } }).sort({ createdAt: -1 }).toArray();
      print(rows.length);
      if (rows.length) { print(rows[0].createdAt.toISOString()); print((rows[0].userName || '?') + ' (' + (rows[0].kind || '') + '): ' + rows[0].text.slice(0, 300)); }" 2>/dev/null)" || continue
    n="$(sed -n 1p <<<"${out}")"
    [[ "${n}" =~ ^[0-9]+$ ]] && (( n > 0 )) || continue
    sed -n 2p <<<"${out}" > "${STATE}/${t}.feedback.seen"
    first="$(sed -n '3,$p' <<<"${out}")"
    notify "${t}: ${n} new feedback" "${first}$( (( n > 1 )) && echo " (and $((n - 1)) more)"). Read all: tenant.sh feedback ${t}" default speech_balloon
  done
}

check_audit() {
  local out high crit mod
  out="$(docker_ run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "${APP_SRC}:/w:ro" -w /w node:22 \
    npm audit --omit=dev --package-lock-only --json 2>/dev/null)" || true
  read -r crit high mod < <(docker_ run --rm -i node:22 node -e '
    let j = {}; try { j = JSON.parse(require("fs").readFileSync(0, "utf8")); } catch {}
    const v = (j.metadata && j.metadata.vulnerabilities) || {};
    console.log([v.critical || 0, v.high || 0, v.moderate || 0].join(" "));' <<<"${out}")
  echo "$(now) audit: ${crit:-?} critical, ${high:-?} high, ${mod:-?} moderate"
  if [[ -z "${crit}" ]]; then
    problem audit "Package check failed" "npm audit could not run (no network to the npm registry?). See ${GPF_ROOT}/logs/monitor.log."
  elif (( crit + high > 0 )); then
    problem audit "Security holes in the app's packages" "${crit} critical, ${high} high (npm audit). Ask Claude to update the packages and test."
  else
    fine audit "App packages OK (${mod} moderate)"
  fi
}

# Each tenant's System card reads backups/MONITOR_STATUS: "checked <time>", then "down <check> <since>".
# Server-wide problems (edge, disk) are shown to every tenant.
write_status() {
  local t f key
  for t in $(tenants); do
    [[ -d "$(t_dir "${t}")/backups" ]] || continue
    {
      echo "checked $(now)"
      for f in "${STATE}"/*.down; do
        [[ -e "${f}" ]] || continue
        key="$(basename "${f}" .down)"
        case "${key}" in
          edge|disk) echo "down ${key} $(cat "${f}")" ;;
          "${t}".*) echo "down ${key#"${t}".} $(cat "${f}")" ;;
        esac
      done
      true
    } > "$(t_dir "${t}")/backups/MONITOR_STATUS.tmp" && mv "$(t_dir "${t}")/backups/MONITOR_STATUS.tmp" "$(t_dir "${t}")/backups/MONITOR_STATUS"
  done
}

case "${1:-}" in
  health) check_health ;;
  backups) check_backups ;;
  disk) check_disk ;;
  feedback) check_feedback; exit 0 ;;
  audit) check_audit; exit 0 ;;
  test) notify "GPF test alert" "Alerts from the GPF server reach this phone." default bell; exit 0 ;;
  *) die "Usage: monitor.sh health|backups|disk|feedback|audit|test" ;;
esac
write_status
