#!/usr/bin/env bash
# Pulls the latest code and redeploys, without losing data:
#   1. safety backup first (stops if it fails)
#   2. record counts before
#   3. pull, rebuild, restart, wait for health
#   4. record counts after; loud failure if any collection has fewer records
# Usage: bash deploy/update.sh
# Wrapped in main() so bash reads the whole script before `git pull` can change it.
main() {
  source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
  cd "${APP_DIR}"
  [[ -f .env ]] || die "No .env yet; run deploy/first-deploy.sh first."

  say "Safety backup before deploying"
  bash "${APP_DIR}/deploy/backup.sh" predeploy || die "Backup failed; nothing was changed."
  local before after
  before="$(record_counts)"

  say "Pulling latest code"
  git pull --ff-only
  git log --oneline -1

  say "Rebuilding and restarting"
  dc up -d --build
  wait_healthy
  docker_ image prune -f >/dev/null

  say "Checking every record is still there"
  after="$(record_counts)"
  if ! compare_counts "${before}" "${after}"; then
    latest="$(ls -1t backups/pool-predeploy-*.archive.gz | head -1)"
    die "Some records are missing after the deploy. Nothing has been deleted from the backup: ${latest}. Restore with: docker compose exec -T mongo mongorestore --drop --archive --gzip < ${latest}"
  fi
  echo "Updated. All records accounted for."
}
main "$@"
