#!/usr/bin/env bash
# Proves the newest backup can be restored: loads it into a scratch database
# (pool_restorecheck), compares record counts with the live database, then
# deletes the scratch copy. The live database is never touched.
# Usage: bash deploy/restore-check.sh [backups/pool-....archive.gz]
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "${APP_DIR}"
archive="${1:-$(ls -1t backups/pool-*.archive.gz 2>/dev/null | head -1)}"
[[ -n "${archive}" && -s "${archive}" ]] || die "No backup archive found"
say "Restoring ${archive} into scratch database pool_restorecheck"
dc exec -T mongo mongosh --quiet pool_restorecheck --eval 'db.dropDatabase()' >/dev/null
dc exec -T mongo mongorestore --quiet --archive --gzip --nsFrom 'pool.*' --nsTo 'pool_restorecheck.*' < "${archive}"
restored="$(record_counts pool_restorecheck)"
live="$(record_counts pool)"
dc exec -T mongo mongosh --quiet pool_restorecheck --eval 'db.dropDatabase()' >/dev/null
say "Backup vs live (live can be higher if you've added records since the backup)"
compare_counts "${restored}" "${live}" backup live || die "The live database has fewer records than the backup!"
echo "Restore check passed: ${archive} restores cleanly."
