#!/usr/bin/env bash
# Changes the first owner's password (GPF item 3: logins live in the database; .env's hash only
# seeds the first owner on the first start with accounts, and is kept in step here). That
# owner's devices are signed out. Other logins: More → Team in the app.
# Usage: bash deploy/set-password.sh          (prompts twice, hidden)
#        echo 'new password' | bash deploy/set-password.sh -
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "${APP_DIR}"
[[ -f .env ]] || die "No .env yet; run deploy/first-deploy.sh first."

if [[ "${1:-}" == "-" ]]; then
  IFS= read -r pw
else
  read -rsp "New app password (min 8 chars): " pw; echo
  read -rsp "Repeat it: " pw2; echo
  [[ "${pw}" == "${pw2}" ]] || die "Passwords don't match."
fi
[[ ${#pw} -ge 8 ]] || die "Use at least 8 characters."

hash="$(printf '%s' "${pw}" | hash_password)"
[[ "${hash}" == '$argon2'* ]] || die "Password hashing failed"

tmp="$(mktemp "${APP_DIR}/.env.XXXX")"
grep -v '^ADMIN_PASSWORD_HASH=' .env > "${tmp}" || true
printf "ADMIN_PASSWORD_HASH='%s'\n" "${hash}" >> "${tmp}"
chmod 600 "${tmp}"
mv "${tmp}" .env

dc up -d --no-deps --force-recreate api
wait_healthy
printf '%s' "${pw}" | dc exec -T api node server/dist/cli/users.js set-password
echo "Password changed."
