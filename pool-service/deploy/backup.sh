#!/usr/bin/env bash
# Dumps the database to backups/pool-<timestamp>.archive.gz and keeps the newest 14.
# Run nightly by cron (installed by first-deploy.sh). Offsite copies come in Phase 6.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "${APP_DIR}"
mkdir -p backups
ts="$(date -u +%Y%m%d-%H%M%S)"
out="backups/pool-${ts}.archive.gz"
dc exec -T mongo mongodump --quiet --archive --gzip --db pool > "${out}.part"
mv "${out}.part" "${out}"
ls -1t backups/pool-*.archive.gz | tail -n +15 | xargs -r rm --
date -u +%Y-%m-%dT%H:%M:%SZ > backups/LAST_BACKUP
echo "Backup written: ${out} ($(du -h "${out}" | cut -f1))"
