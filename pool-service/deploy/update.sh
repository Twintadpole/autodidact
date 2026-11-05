#!/usr/bin/env bash
# Pulls the latest code and redeploys. Data and .env are kept.
# Usage: bash deploy/update.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "${APP_DIR}"
[[ -f .env ]] || die "No .env yet; run deploy/first-deploy.sh first."

say "Pulling latest code"
git pull --ff-only
git log --oneline -1

say "Rebuilding and restarting"
dc up -d --build
wait_healthy
docker_ image prune -f >/dev/null
echo "Updated."
