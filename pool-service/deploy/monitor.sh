#!/usr/bin/env bash
# Checks the app, the disk and the backups, and sends phone alerts through the self-hosted
# ntfy (topic pool-alerts). One alert when a problem starts, one "OK again" when it ends.
# Run from cron (see deploy/README.md, "Alerts"):
#   bash deploy/monitor.sh app       every 5 min: the public site's health; alerts after 2 failures in a row (10 min)
#   bash deploy/monitor.sh disk      hourly: alerts when / is over DISK_LIMIT % full (default 80)
#   bash deploy/monitor.sh backups   daily: alerts if the nightly backup or its R2 copy is over 26 h old,
#                                    or the weekly R2 restore check hasn't passed in 8 days
#   bash deploy/monitor.sh boot      after a restart (cron @reboot): reports to the phone whether everything came back
#   bash deploy/monitor.sh test      sends a test alert
# A whole-server outage can't be reported from here: Cloudflare's tunnel health email covers that.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "${APP_DIR}"

ALERTS_DIR="${HOME}/.config/pool-alerts"
STATE="${HOME}/.local/state/pool-monitor"
NTFY_URL="http://127.0.0.1:2586/pool-alerts"
APP_URL="${MONITOR_URL:-https://poolapp.evolutiondfw.com/api/health}"
DISK_LIMIT="${DISK_LIMIT:-80}"
mkdir -p "${STATE}"

# notify <title> <message> [priority] [tags]
notify() {
  local token
  token="$(cat "${ALERTS_DIR}/ntfy-token")"
  curl -fsS --max-time 20 -o /dev/null -H "Authorization: Bearer ${token}" \
    -H "Title: $1" -H "Priority: ${3:-default}" -H "Tags: ${4:-}" -d "$2" "${NTFY_URL}" ||
    echo "$(date -u +%FT%TZ) could not send alert: $1: $2" >&2
}
# problem <name> <title> <message>: alert once, when the problem starts
problem() {
  echo "$(date -u +%FT%TZ) PROBLEM $1: $3"
  [[ -e "${STATE}/$1.down" ]] && return 0
  date -u +%FT%TZ > "${STATE}/$1.down"
  notify "$2" "$3" high warning
}
# fine <name> <title>: "OK again" once, if there was a problem
fine() {
  [[ -e "${STATE}/$1.down" ]] || return 0
  local since
  since="$(cat "${STATE}/$1.down")"
  rm -f "${STATE}/$1.down"
  echo "$(date -u +%FT%TZ) OK $1"
  notify "$2" "OK again (problem since ${since})" default white_check_mark
}
age_hours() { # file → hours since the timestamp inside it (999 if missing)
  [[ -s "$1" ]] || { echo 999; return; }
  echo $(( ($(date +%s) - $(date -d "$(cat "$1")" +%s)) / 3600 ))
}

check_app() {
  if curl -fsS --max-time 20 "${APP_URL}" 2>/dev/null | grep -q '"mongo":true'; then
    rm -f "${STATE}/app.fails"
    fine app "Pool app is back up"
    return
  fi
  local fails=$(( $(cat "${STATE}/app.fails" 2>/dev/null || echo 0) + 1 ))
  echo "${fails}" > "${STATE}/app.fails"
  (( fails >= 2 )) || return 0
  local why
  if curl -fsS --max-time 10 http://127.0.0.1:3000/api/health 2>/dev/null | grep -q '"mongo":true'; then
    why="The app runs on the server but the site can't be reached. Check the Cloudflare tunnel (cloudflared)."
  elif curl -fsS --max-time 10 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    why="The app is up but the database isn't answering."
  else
    why="The app isn't running on the server."
  fi
  problem app "Pool app is DOWN" "${why} Failing for $(( fails * 5 )) minutes."
}

check_disk() {
  local used
  used="$(df --output=pcent / | tail -1 | tr -dc 0-9)"
  if (( used > DISK_LIMIT )); then
    problem disk "Server disk ${used}% full" "The server's disk is ${used}% full (limit ${DISK_LIMIT}%). Backups and photos need space."
  else
    fine disk "Server disk OK (${used}% full)"
  fi
}

check_backups() {
  local issues=()
  local b o r
  b="$(age_hours backups/LAST_BACKUP)"
  (( b <= 26 )) || issues+=("Nightly backup: last one ${b} h ago.")
  if offsite_configured; then
    o="$(age_hours backups/LAST_OFFSITE)"
    (( o <= 26 )) || issues+=("R2 offsite copy: last one ${o} h ago.")
    r="$(age_hours backups/LAST_RESTORE_CHECK)"
    (( r <= 8 * 24 )) || issues+=("Weekly R2 restore check: last pass $(( r / 24 )) days ago.")
  fi
  if (( ${#issues[@]} )); then
    problem backups "Backup problem" "${issues[*]} See backups/backup.log and backups/restore-check.log."
  else
    fine backups "Backups OK"
  fi
}

report_boot() {
  local lines=() ok=1 svc
  for svc in api mongo ntfy; do
    if [[ "$(docker_ inspect -f '{{.State.Health.Status}}' "pool-service-${svc}-1" 2>/dev/null)" == healthy ]]; then
      lines+=("${svc}: healthy")
    else
      lines+=("${svc}: NOT healthy"); ok=0
    fi
  done
  if curl -fsS --max-time 20 "${APP_URL}" 2>/dev/null | grep -q '"mongo":true'; then
    lines+=("site: reachable through Cloudflare")
  else
    lines+=("site: NOT reachable"); ok=0
  fi
  [[ -e /var/run/reboot-required ]] && lines+=("reboot still required")
  local IFS=$'\n'
  if (( ok )); then
    notify "Server restarted: all OK" "Up since $(uptime -s).${IFS}${lines[*]}" default white_check_mark
  else
    notify "Server restarted: PROBLEM" "Up since $(uptime -s).${IFS}${lines[*]}" high warning
  fi
}

case "${1:-}" in
  boot) report_boot ;;
  app) check_app ;;
  disk) check_disk ;;
  backups) check_backups ;;
  test) notify "Test alert" "Alerts from the pool server reach this phone." default bell ;;
  *) die "Usage: monitor.sh app|disk|backups|boot|test" ;;
esac

# For the app's System card: when the checks last ran and which alerts are open (read by /api/system/status).
if [[ "${1:-}" =~ ^(app|disk|backups)$ ]]; then
  {
    echo "checked $(date -u +%FT%TZ)"
    for f in "${STATE}"/*.down; do
      if [[ -e "$f" ]]; then echo "down $(basename "$f" .down) $(cat "$f")"; fi
    done
    true
  } > backups/MONITOR_STATUS.tmp && mv backups/MONITOR_STATUS.tmp backups/MONITOR_STATUS
fi
