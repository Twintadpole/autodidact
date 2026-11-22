#!/usr/bin/env bash
# Sends this server's app emails (password reset links and notices) through the mailbox set up in
# ~/.config/pool-mail (see deploy/mail-lib.sh and deploy/README.md, "Email"). Cron, every minute:
#   * * * * * bash ~/autodidact/pool-service/deploy/mail.sh >> ~/autodidact/pool-service/backups/mail.log 2>&1
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
source "$(dirname "${BASH_SOURCE[0]}")/mail-lib.sh"
cd "${APP_DIR}"
mail_mongo() { dc exec -T mongo mongosh --quiet pool --eval "$(cat)"; }
mail_send_pending "${APP_DIR}/backups" app
