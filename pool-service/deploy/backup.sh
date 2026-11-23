#!/usr/bin/env bash
# Dumps the database to backups/pool-<timestamp>.archive.gz (nightly, keeps 14).
#   bash deploy/backup.sh            nightly backup (cron, installed by first-deploy.sh)
#   bash deploy/backup.sh predeploy  safety copy taken by update.sh before every deploy (keeps 10)
# Nightly runs then send that dump plus all photos offsite to Cloudflare R2, encrypted by restic
# (keeps 14 daily, 8 weekly, 12 monthly), once ~/.config/pool-backup/ holds the keys (see lib.sh).
# If the offsite copy fails, the local backup is still kept; the script exits 2 and logs why.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "${APP_DIR}"
mkdir -p backups
label="${1:-}"
ts="$(date -u +%Y%m%d-%H%M%S)"
if [[ -n "${label}" ]]; then
  out="backups/pool-${label}-${ts}.archive.gz"
  keep=10
  pattern="backups/pool-${label}-*.archive.gz"
else
  out="backups/pool-${ts}.archive.gz"
  keep=14
  pattern="backups/pool-2*.archive.gz"
fi
dc exec -T mongo mongodump --quiet --archive --gzip --db pool > "${out}.part"
[[ -s "${out}.part" ]] || { rm -f "${out}.part"; die "Backup is empty"; }
mv "${out}.part" "${out}"
# shellcheck disable=SC2086 # pattern is a glob on purpose
ls -1t ${pattern} 2>/dev/null | tail -n +$((keep + 1)) | xargs -r rm --
date -u +%Y-%m-%dT%H:%M:%SZ > backups/LAST_BACKUP
echo "Backup written: ${out} ($(du -h "${out}" | cut -f1))"

# ---- Offsite copy (nightly only)
offsite_backup() {
  restic_ -v "${APP_DIR}/${out}:/data/db.archive.gz:ro" -v "${APP_DIR}/data/photos:/data/photos:ro" -- \
    backup --quiet --host pool-vps --tag nightly /data/db.archive.gz /data/photos || return 1
  restic_ -- forget --quiet --host pool-vps --tag nightly --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune || return 1
}
if [[ -z "${label}" ]] && offsite_configured; then
  if offsite_backup; then
    date -u +%Y-%m-%dT%H:%M:%SZ > backups/LAST_OFFSITE
    echo "Offsite copy sent to R2 (database + $(find data/photos -type f | wc -l) photo files)"
  else
    echo "OFFSITE BACKUP FAILED $(date -u +%Y-%m-%dT%H:%M:%SZ): the local backup ${out} is fine; the R2 copy was not made" >&2
    exit 2
  fi
fi
