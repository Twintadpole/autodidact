#!/usr/bin/env bash
# Proves the newest backup can be restored: loads it into a scratch database
# (pool_restorecheck), compares record counts with the live database, then
# deletes the scratch copy. The live database is never touched.
# Usage: bash deploy/restore-check.sh [backups/pool-....archive.gz]
#        bash deploy/restore-check.sh --offsite   the newest copy in Cloudflare R2: first reads
#            every byte of the R2 copy to prove it's intact, then restores it the same way and
#            compares its photo files with the server's (weekly, from cron)
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "${APP_DIR}"
restore_into_scratch() { dc exec -T mongo mongorestore --quiet --archive --gzip --nsFrom 'pool.*' --nsTo 'pool_restorecheck.*'; }
dc exec -T mongo mongosh --quiet pool_restorecheck --eval 'db.dropDatabase()' >/dev/null
if [[ "${1:-}" == "--offsite" ]]; then
  offsite_configured || die "Offsite backups aren't set up (no keys in ${OFFSITE_DIR})"
  archive="the newest R2 copy"
  say "Reading every byte of the R2 copy to prove it's intact"
  restic_ -- check --read-data --quiet || die "The R2 copy is damaged or can't be read"
  restic_ -- snapshots --latest 1 --compact
  say "Restoring ${archive} into scratch database pool_restorecheck"
  restic_ -- dump latest /data/db.archive.gz | restore_into_scratch
  offsite_photos="$(restic_ -- ls --json --recursive latest /data/photos | grep -c '"type":"file"' || true)"
  local_photos="$(find data/photos -type f | wc -l)"
  echo "Photo files: ${offsite_photos} in R2, ${local_photos} on this server (the server can be higher if photos were added since)"
  (( offsite_photos > 0 || local_photos == 0 )) || die "No photo files in the R2 copy"
else
  archive="${1:-$(ls -1t backups/pool-*.archive.gz 2>/dev/null | head -1)}"
  [[ -n "${archive}" && -s "${archive}" ]] || die "No backup archive found"
  say "Restoring ${archive} into scratch database pool_restorecheck"
  restore_into_scratch < "${archive}"
fi
restored="$(record_counts pool_restorecheck)"
live="$(record_counts pool)"
dc exec -T mongo mongosh --quiet pool_restorecheck --eval 'db.dropDatabase()' >/dev/null
say "Backup vs live (live can be higher if you've added records since the backup)"
compare_counts "${restored}" "${live}" backup live || die "The live database has fewer records than the backup!"
[[ "${1:-}" == "--offsite" ]] && date -u +%Y-%m-%dT%H:%M:%SZ > backups/LAST_RESTORE_CHECK
echo "Restore check passed: ${archive} restores cleanly."
