# Great Pool Friend: operator guide

For the operator (you) running Great Pool Friend on a server: your own business's app and the Great Pool Friend businesses ("tenants"). Every command below runs on the server as user `claude`, from `~/autodidact`, unless it says otherwise.

**From your phone (Termux logs in as root),** become `claude` first:

```
sudo -iu claude
cd ~/autodidact
```

Then type the commands as written. Shortcut: `gpf` is the same as `bash gpf/tenant.sh`, so `gpf list` works from any folder, and from root in one line: `sudo -iu claude gpf list`. Claude can run any of them for you; this guide is so you know what exists and can do it yourself.

## 1. The big picture

There are two separate things on the server:

- **Your own app** at **poolapp.evolutiondfw.com**: Evolution Home Solutions' live data. Folder `~/autodidact/pool-service`. Changed only with `deploy/update.sh`, and only when you say "deploy".
- **Great Pool Friend (GPF)**: one copy of the app per business. Folder `~/gpf` (data), `~/.config/gpf` (secrets), `~/autodidact/gpf` (the kit). Managed with `gpf/tenant.sh`.
  - **demo.greatpoolfriend.com** is the tenant named `demo`: the demo and test business, with made-up data. New versions go there first.
  - Every other business is `<name>.greatpoolfriend.com`, for example `bluewave.greatpoolfriend.com`.
  - During the move from evolutiondfw.com (Nov 23), the old addresses (`gpf.evolutiondfw.com`, …) still work too; see section 10.

How a GPF request travels: phone → Cloudflare → your Cloudflare Tunnel → Traefik on the server (127.0.0.1:8080) → that business's app → that business's own database. Each business has its own sealed network, database, passwords, backup key and folders. One business can never reach another's data, and the apps have no internet access of their own.

## 2. Logins: who can do what

- **In an app:** the **Owner** role can do everything in that one business (team, money, settings, import and export). **Techs** see their own route, with no money figures.
- **Your own app:** your login becomes **steven@evolutiondfw.com** at the next deploy (the `OWNER_EMAIL` line in `pool-service/.env`).
- **Across all businesses:** there is no web "master" login, on purpose. Your control over every business is the server: `tenant.sh`. Support access to a business's app happens only when they ask (for example, they add you as an owner in their Team, or you give their owner a new temporary password).

## 3. Your routine

**Every day (2 minutes):** read the ntfy app. Topic **pool-alerts** is your own app; **gpf-alerts** is every GPF business (down, late backups, disk, new feedback). No news is good news: an alert is sent when a problem starts, and "OK again" when it ends.

**Every week:**

1. `bash gpf/tenant.sh list`: every business, its health, techs active this month, version, last backup.
2. `bash gpf/tenant.sh feedback all 7`: what testers wrote this week.
3. `bash gpf/tenant.sh errors all 7`: errors the apps ran into on phones.
4. Glance at `free -m` and `df -h /`: memory and disk.

**Every month:** `bash gpf/tenant.sh billing` (who would be billed; nothing is charged during the beta).

## 4. Adding a beta tester (a new business)

1. **Pick a short name** for their address: lowercase letters, digits and dashes, for example `sunnypools`. Their address will be `https://sunnypools.greatpoolfriend.com`.
2. **Cloudflare:** nothing to do. The wildcard `*.greatpoolfriend.com` sends every name to the server (section 10).
3. **Create it:** `bash gpf/tenant.sh create sunnypools owner@theirbusiness.com`. This makes the secrets, the network, the database, the route and their owner login with a temporary password. The password is saved, never printed, in `~/.config/gpf/tenants/sunnypools/owner-password`.
4. **Check it:** open `https://sunnypools.greatpoolfriend.com`. You should see the Great Pool Friend login.
5. **Make their guides:** `bash gpf/tenant.sh welcome sunnypools` → `~/gpf/tenants/sunnypools/docs/welcome-sunnypools.pdf` (address, login, first steps) and `beta-tester-guide.pdf`. The terms and privacy PDFs are in `~/gpf/docs/` (`bash gpf/tenant.sh docs`).
6. **Send them:** email the PDFs. Send the temporary password **separately**, by text: `cat ~/.config/gpf/tenants/sunnypools/owner-password`.
7. **They take it from there:** at their first login they choose their own password, see three welcome screens, and follow the Getting started card. They add their techs under More → Team, and Invite texts each tech their login.

From then on, nightly backups, the weekly restore check, alerts and feedback cover them automatically.

**Room on this server:** each business uses about 230 MB of memory when idle (its app is capped at 384 MB, its database at 640 MB). This server has about 3.3 GB, of which your app and the edge use about 0.5 GB. Plan on **4 to 6 beta businesses here**; check `free -m` ("available") before adding one and keep at least 600 MB free. More than that belongs on the home-lab server.

## 5. Helping a business

| They need | Do |
| --- | --- |
| A tech forgot their password | They tap **Forgot password?** (email link). Or their owner: More → Team → New temporary password. |
| The owner forgot their password | **Forgot password?**, or `bash gpf/tenant.sh owner-password <name>` (new temporary password in `owner-password`; their devices are signed out). |
| To see who has logins | `bash gpf/tenant.sh users <name>` |
| A copy of all their data | `bash gpf/tenant.sh export <name>` → `~/gpf/tenants/<name>/exports/<time>/everything.xlsx` + `photos.zip` |
| To pause (unpaid, on request) | `bash gpf/tenant.sh suspend <name>`: their address shows "paused"; data and backups carry on. `resume <name>` undoes it. |
| Records deleted by mistake | `restore <name> --dry-run`, then `--confirm <name>` (section 7). |
| To leave | `export <name>` (send it to them), then `delete <name> --confirm <name>`: a final backup is kept 90 days. After 90 days: `purge <name-time> --confirm <name-time>`. |

## 6. Updating the app (test first)

New versions are built from the code in `~/autodidact` (Claude commits and pushes them):

1. `bash gpf/tenant.sh build`: builds image `gpf-api:<commit>` and makes it the default for new businesses.
2. `bash gpf/tenant.sh update demo`: the **test business first**. Try it on demo.greatpoolfriend.com.
3. When it's good: `bash gpf/tenant.sh update all`. Every update takes a backup first, compares record counts before and after, and stops at the first problem.

A business can stay on an older version: `bash gpf/tenant.sh update <name> gpf-api:<older-commit>`. `list` shows who runs what.

**Your own app** is separate and never changes with GPF updates: Claude runs `deploy/update.sh` only when you say "deploy". It also takes a backup first and compares record counts.

## 7. Backups and restoring

| What | When | Where |
| --- | --- | --- |
| Your app | 03:17 nightly; restore check Sundays 04:47 | `pool-service/backups/` + encrypted copy in R2 (`pool-backup`) |
| Each GPF business | 02:37 nightly; restore check Sundays 05:13 | `~/gpf/tenants/<name>/backups/` + encrypted copy (each business has its own key) |

Copies kept: 14 daily, 8 weekly, 12 monthly. The weekly restore check reads every byte of the off-site copy, restores it into a scratch database and compares the counts with the live one. A failure is an alert.

**Keep the keys off the server.** Without them, the off-site copies can't be read:
- your app: `~/.config/pool-backup/restic-password`
- each business: `~/.config/gpf/tenants/<name>/restic-password`

Copy them into your password manager.

**Restoring a business** (for example, a business deleted records by mistake):

1. Look first, change nothing: `bash gpf/tenant.sh restore <name> --dry-run`. It checks the newest nightly backup in a scratch database and shows its records next to today's ("FEWER" = the restore would remove those).
2. Pick the backup:
   - the newest nightly one (default),
   - a specific file: `--file ~/gpf/tenants/<name>/backups/pool-<date>.archive.gz` (the last 14 nights are there),
   - or an off-site copy: `--offsite local|r2`, plus `--snapshot <id>` from `bash gpf/tenant.sh snapshots <name>` (up to 12 months back). Off-site copies also bring back missing photos; none are ever removed.
3. Restore: the same command with `--confirm <name>` instead of `--dry-run`. It takes a safety backup first, stops the app for the minute it takes, restores, starts it again and checks the counts.
4. It prints the command that **undoes** it (restoring the safety backup). Every phone reloads its data at its next sync; logins are as they were in that backup.

Only that business is touched. Tell its owner before you do it: anything entered after the backup's time is gone (it stays in the safety backup).

## 8. Alerts (ntfy)

| Alert | What to do |
| --- | --- |
| `<name> is DOWN` | Usually fixes itself (Docker restarts the app). If it lasts: `docker compose -p gpf-t-<name> logs --tail 50`, or ask Claude. |
| `GPF edge is DOWN` | Every business is unreachable: `bash gpf/tenant.sh edge-up`. |
| `<name>: backup problem` | Look at `~/gpf/logs/backup.log` / `restore-check.log`; ask Claude. |
| `GPF server disk N% full` | Old exports and photos take space; ask Claude before deleting anything. |
| `<name>: N new feedback` | Read it: `bash gpf/tenant.sh feedback <name>`. |
| `Pool app is DOWN` (pool-alerts) | Your own app; see `pool-service/deploy/README.md`. |

A whole-server outage can't alert from the server itself: Cloudflare emails you when the tunnel is down.

**Something on the pages that isn't ours** (a banner, "Hello world", a cookie popup): Cloudflare can insert scripts into every page it passes along (Zaraz, Snippets, Workers). Check evolutiondfw.com → Zaraz in the Cloudflare dashboard first; it is turned off on purpose (Nov 23), and the Privacy page promises no tracking.

## 9. Email (password reset)

The apps never send mail themselves (GPF apps have no internet). Each app queues its emails, and the server sends them every minute through **Twintadpole@gmail.com**:

- settings: `~/.config/pool-mail/mail.env`
- password: `~/.config/pool-mail/gmail-app-password` (a Gmail **app password**, file mode 600). Typed with `nano`, never in chat.

Until that password file exists, "Forgot password?" tells people to ask their owner. Logs: `~/gpf/logs/mail.log`, and `pool-service/backups/mail.log` for your app.

## 10. Addresses and the Cloudflare Tunnel

- Every business is `<name>.greatpoolfriend.com`. One wildcard in the tunnel covers them all: public hostname `*.greatpoolfriend.com` → HTTP `localhost:8080` (with a DNS record `*`, CNAME to the tunnel, proxied). Cloudflare's free certificate covers `greatpoolfriend.com` and `*.greatpoolfriend.com`.
- The kit's settings are in `~/.config/gpf/kit.env`: `GPF_DOMAIN=greatpoolfriend.com` (addresses, email links, guides) and `GPF_ALIAS_DOMAINS=evolutiondfw.com` (old addresses that still answer during the move).
- **Ending the move:** once everyone uses the new addresses, delete the `GPF_ALIAS_DOMAINS` line and run `bash gpf/tenant.sh update all`. The old addresses then stop answering. Remove their tunnel hostnames (`gpf`, `bluewave` on evolutiondfw.com) in Cloudflare.
- An installed app is tied to its address: after a move, people open the new address once and install it again. Their data is on the server.
- Keep Zaraz off on greatpoolfriend.com too (section 8).
- Your own app stays at poolapp.evolutiondfw.com and isn't part of this.

**Support email:** `support@greatpoolfriend.com` (Cloudflare → greatpoolfriend.com → Email → Email Routing: forward it to your Gmail). The app, the guides and the Terms show it.

## 11. Feedback, errors and translations

- Feedback: `bash gpf/tenant.sh feedback <name|all> [days]`. Owners also see their team's feedback in the app (More → Send feedback) and can tick it done.
- Errors: `bash gpf/tenant.sh errors <name|all> [days]`: counted per kind and app version, kept 60 days.
- Translations: review sheets in `~/translation-review/` (one per language) and `translator-guide.pdf`. Returned sheets: give them to Claude, who shows you the changes and imports them.

## 12. Where everything is

| Path | What |
| --- | --- |
| `~/autodidact` | The code (git; branch `claude/new-session-q17smb`) |
| `~/autodidact/pool-service` | Your app; `.env` (secrets, never shared), `backups/`, `data/` |
| `~/autodidact/gpf` | The tenant kit: `tenant.sh`, `monitor.sh`, `docs/` |
| `~/gpf/tenants/<name>/` | A business's data, backups, exports, docs |
| `~/gpf/deleted/` | Deleted businesses' final backups (90 days) |
| `~/gpf/logs/` | Backup, restore-check, monitor and mail logs |
| `~/gpf/docs/` | Guides as PDFs (`bash gpf/tenant.sh docs`) |
| `~/.config/gpf/` | Secrets per business (700/600); `kit.env` settings |
| `~/.config/pool-mail/` | Mailbox settings and app password |
| `~/.config/pool-backup/`, `~/.config/pool-alerts/` | Your app's R2 and ntfy keys |

Scheduled jobs: `crontab -l` (user `claude`). The GPF ones are between the `# gpf-kit begin` and `# gpf-kit end` lines, and `bash gpf/tenant.sh cron --install` rewrites them.

## 13. Safety rules

- Never `first-deploy.sh` or `cleanup-orphans.sh --apply` on your app; never edit `.env` files by hand except to add a line you were given.
- Never paste passwords, keys or app passwords into chat; use `nano` on the server.
- Never `docker compose down -v`, and never delete a folder under `~/gpf/tenants` by hand: use `tenant.sh delete`, which keeps a final backup.
- Updates always go to the test business first.

## 13b. Security

**Built into the app:**
- strict checks on every request, with length limits on every field
- passwords stored only as argon2 hashes
- a login limit per address, plus a lock per login after 10 wrong passwords
- one-use reset links
- photos and logos must be real pictures, and photos are saved again without their hidden GPS location and camera details
- browser safety headers: no outside or inline scripts, can't be framed, HTTPS only
- each business sealed in its own network and database, with encrypted backups under its own key

People can type any characters, in any language. That's safe because the app shows everything typed as plain text.

**Monthly:** `monitor.sh audit` checks the app's packages for known security holes and alerts on `gpf-alerts` if a high or critical one appears. Ask Claude to update and test.

**Cloudflare settings** (for greatpoolfriend.com, and for evolutiondfw.com too):

1. **SSL/TLS → Edge Certificates:** Always Use HTTPS **on**; Minimum TLS Version **1.2**; Automatic HTTPS Rewrites **on**.
2. **Security → WAF → Managed rules:** turn on the **Cloudflare Free Managed Ruleset** (it blocks common attacks before they reach the server).
3. **Security → WAF → Rate limiting rules → Create:** name "Login limit"; when URI Path **starts with** `/api/auth/`; **10 requests per 1 minute** per IP; action **Block** for 10 minutes. (The app has its own limits too; this stops floods at Cloudflare.)
4. **Security → Bots:** leave **Bot Fight Mode off**. It can challenge the phone app's background requests. The rules above are enough.
5. **Zaraz:** off (section 8).
6. **No Cloudflare Access on the businesses' addresses.** Their logins are the app's own. Your own app keeps its Access login.

Later, if wanted: two-step login (an authenticator-app code) for owners.

## 14. Moving to the home lab (before July 2027)

The kit was built for this move: on the new server, install Docker, set `default-address-pools` in `/etc/docker/daemon.json`, copy `~/autodidact`, `~/gpf`, `~/.config/gpf` and `~/.config/pool-mail`, run `bash gpf/tenant.sh edge-up`, start each business, point the tunnel there, and install the cron jobs. Claude does the move when the server is ready.

## Support

Claude, in the Claude app (Remote Control on this server).
