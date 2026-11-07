#!/usr/bin/env bash
# One-time cleanup: hides (soft-deletes) visits, issues, notes and photos that were
# left behind under pools/customers that are already deleted. Nothing is erased.
#   bash deploy/cleanup-orphans.sh                 dry run: lists what would be hidden
#   bash deploy/cleanup-orphans.sh --apply <count> hides exactly the <count> records the dry run listed
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "${APP_DIR}"
apply=0
if [[ "${1:-}" == "--apply" ]]; then
  [[ "${2:-}" =~ ^[0-9]+$ && "${2}" -gt 0 ]] || die "Usage: --apply <count from the dry run>"
  apply="$2"
  bash "${APP_DIR}/deploy/backup.sh" predeploy || die "Backup failed; nothing changed."
fi
dc exec -T mongo mongosh --quiet pool --eval "const APPLY = ${apply};
$(cat "${APP_DIR}/deploy/mongo/orphans.js")"
