#!/usr/bin/env bash
# Dumps the database to backups/pool-<timestamp>.archive.gz (nightly, keeps 14).
#   bash deploy/backup.sh            nightly backup (cron, installed by first-deploy.sh)
#   bash deploy/backup.sh predeploy  safety copy taken by update.sh before every deploy (keeps 10)
# Offsite copies come in Phase 6.
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
