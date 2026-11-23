#!/usr/bin/env bash
# Sends the app's queued emails (collection mailOutbox: password reset links and notices). Shared by
# deploy/mail.sh (this server's own app) and gpf/tenant.sh mail (every business). Source it; the caller
# defines mail_mongo, which runs a mongosh script (stdin) against the app's database and prints its output.
#
# Settings, in MAIL_CONFIG_DIR (default ~/.config/pool-mail):
#   mail.env                MAIL_SMTP_URL (default smtps://smtp.gmail.com:465), MAIL_USER, MAIL_FROM
#   gmail-app-password      the mailbox's app password (600; typed with nano, never in chat or a log)
# Without a password file (and an smtps:// URL) nothing is sent and MAIL_READY is removed, so the app
# tells people to ask their owner instead. Tests use a plain smtp:// URL with no password (Mailpit).

MAIL_CONFIG_DIR="${MAIL_CONFIG_DIR:-${HOME}/.config/pool-mail}"
MAIL_SMTP_URL="smtps://smtp.gmail.com:465"
MAIL_USER=""
MAIL_FROM=""
if [[ -f "${MAIL_CONFIG_DIR}/mail.env" ]]; then
  while IFS='=' read -r k v; do
    [[ "${k}" =~ ^MAIL_(SMTP_URL|USER|FROM)$ ]] && printf -v "${k}" '%s' "${v}"
  done < <(grep -E '^MAIL_(SMTP_URL|USER|FROM)=' "${MAIL_CONFIG_DIR}/mail.env")
fi
MAIL_PASSWORD_FILE="${MAIL_CONFIG_DIR}/gmail-app-password"
MAIL_MAX_ATTEMPTS=5

# mail_configured: a mailbox to send through (a password, or a plain local test server)
mail_configured() {
  [[ -n "${MAIL_FROM}" ]] || return 1
  if [[ "${MAIL_SMTP_URL}" == smtp://* ]]; then return 0; fi
  [[ -n "${MAIL_USER}" && -s "${MAIL_PASSWORD_FILE}" ]]
}
mail_from_address() { sed -E 's/.*<([^>]+)>.*/\1/' <<<"${MAIL_FROM}"; }

# mail_send_pending <backups-dir> <label> [flag-file]: sends what's waiting; MAIL_READY tells the app
# email works. With a flag file (the app touches it when it queues mail), the database is opened only
# when the flag is newer than the last look, or every 15 minutes as a safety net: starting mongosh
# costs about a second of CPU, which adds up with many businesses checked every minute.
mail_send_pending() {
  local backups="$1" label="$2" flag="${3:-}"
  if ! mail_configured; then
    rm -f "${backups}/MAIL_READY"
    return 0
  fi
  date -u +%FT%TZ > "${backups}/MAIL_READY"
  if [[ -n "${flag}" ]]; then
    local stamp seen
    stamp="$(date -r "${flag}" +%s%N 2>/dev/null || echo 0)"
    seen="$(cat "${backups}/.mail-seen" 2>/dev/null || echo 0)"
    if (( stamp <= seen )) && (( 10#$(date +%M) % 15 != 0 )); then return 0; fi
    echo "${stamp}" > "${backups}/.mail-seen"
  fi
  local pending id
  pending="$(mail_mongo <<<"
    db.mailOutbox.find({ sentAt: null, attempts: { \$lt: ${MAIL_MAX_ATTEMPTS} } }).sort({ createdAt: 1 }).limit(20)
      .forEach((m) => print(JSON.stringify({ id: m._id, to: m.to, kind: m.kind || '' })));")" || { echo "${label}: could not read the outbox" >&2; return 1; }
  [[ -n "${pending}" ]] || return 0
  local tmp rc failed=0
  tmp="$(mktemp)"
  while IFS= read -r line; do
    [[ "${line}" == \{* ]] || continue
    id="$(sed -E 's/.*"id":"([^"]+)".*/\1/' <<<"${line}")"
    [[ "${id}" =~ ^[0-9a-f-]{36}$ ]] || continue
    local rcpts=()
    while IFS= read -r r; do [[ -n "${r}" ]] && rcpts+=(--mail-rcpt "${r}"); done < <(sed -E 's/.*"to":\[([^]]*)\].*/\1/' <<<"${line}" | tr ',' '\n' | tr -d '"')
    { printf 'From: %s\r\n' "${MAIL_FROM}"; mail_mongo <<<"print(db.mailOutbox.findOne({ _id: '${id}' }).raw)"; } > "${tmp}"
    set +e
    if [[ "${MAIL_SMTP_URL}" == smtp://* ]]; then
      curl -sS --max-time 60 --url "${MAIL_SMTP_URL}" --mail-from "$(mail_from_address)" "${rcpts[@]}" --upload-file "${tmp}" 2>"${tmp}.err"
    else
      # The password reaches curl through a file descriptor, never on its command line.
      curl -sS --max-time 60 --ssl-reqd --url "${MAIL_SMTP_URL}" -K <(printf 'user = "%s:%s"\n' "${MAIL_USER}" "$(cat "${MAIL_PASSWORD_FILE}")") \
        --mail-from "$(mail_from_address)" "${rcpts[@]}" --upload-file "${tmp}" 2>"${tmp}.err"
    fi
    rc=$?
    set -e
    if (( rc == 0 )); then
      mail_mongo <<<"db.mailOutbox.updateOne({ _id: '${id}' }, { \$set: { sentAt: new Date(), error: null }, \$inc: { attempts: 1 } })" >/dev/null
      echo "$(date -u +%FT%TZ) ${label}: sent ${id} ($(sed -E 's/.*"kind":"([^"]*)".*/\1/' <<<"${line}"), $(( ${#rcpts[@]} / 2 )) recipient(s))"
    else
      local err; err="$(head -c 300 "${tmp}.err" | tr -d "'\"\\\\\n")"
      mail_mongo <<<"db.mailOutbox.updateOne({ _id: '${id}' }, { \$set: { error: '${err}' }, \$inc: { attempts: 1 } })" >/dev/null
      echo "$(date -u +%FT%TZ) ${label}: FAILED ${id}: ${err}" >&2
      failed=1
    fi
  done <<<"${pending}"
  rm -f "${tmp}" "${tmp}.err"
  return "${failed}"
}
