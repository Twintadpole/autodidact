# Great Pool Friend: operator guide

For the operator (you) running Great Pool Friend on a server: your own business's app and the Great Pool Friend businesses ("tenants"). Every command below runs on the server as user `claude`, from `~/autodidact`, unless it says otherwise. Claude can run any of them for you; this guide is so you know what exists and can do it yourself.

## 1. The big picture

There are two separate things on the server:

- **Your own app** at **poolapp.evolutiondfw.com**: Evolution Home Solutions' live data. Folder `~/autodidact/pool-service`. Changed only with `deploy/update.sh`, and only when you say "deploy".
- **Great Pool Friend (GPF)**: one copy of the app per business. Folder `~/gpf` (data), `~/.config/gpf` (secrets), `~/autodidact/gpf` (the kit). Managed with `gpf/tenant.sh`.
  - **gpf.evolutiondfw.com** is the tenant named `gpf`: the demo and test business. New versions go there first.
  - Every other business is `<name>.evolutiondfw.com`, for example `bluewave.evolutiondfw.com`.

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

1. **Pick a short name** for their address: lowercase letters, digits and dashes, for example `sunnypools`. Their address will be `https://sunnypools.evolutiondfw.com`.
2. **Cloudflare** (dashboard → Zero Trust → Networks → Tunnels → your tunnel → Public hostnames → Add): subdomain `sunnypools`, domain `evolutiondfw.com`, service **HTTP** `localhost:8080`. Skip this step if you've set up the wildcard (section 10).
3. **Create it:** `bash gpf/tenant.sh create sunnypools owner@theirbusiness.com`. This makes the secrets, the network, the database, the route and their owner login with a temporary password. The password is saved, never printed, in `~/.config/gpf/tenants/sunnypools/owner-password`.
4. **Check it:** open `https://sunnypools.evolutiondfw.com`. You should see the Great Pool Friend login.
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
| To leave | `export <name>` (send it to them), then `delete <name> --confirm <name>`: a final backup is kept 90 days. After 90 days: `purge <name-time> --confirm <name-time>`. |

## 6. Updating the app (test first)

New versions are built from the code in `~/autodidact` (Claude commits and pushes them):

1. `bash gpf/tenant.sh build`: builds image `gpf-api:<commit>` and makes it the default for new businesses.
2. `bash gpf/tenant.sh update gpf`: the **test business first**. Try it on gpf.evolutiondfw.com.
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

**Restoring a business** from a backup isn't a one-command job yet: ask Claude. That command is on the list before the paid launch.

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

## 9. Email (password reset)

The apps never send mail themselves (GPF apps have no internet). Each app queues its emails, and the server sends them every minute through **Twintadpole@gmail.com**:

- settings: `~/.config/pool-mail/mail.env`
- password: `~/.config/pool-mail/gmail-app-password` (a Gmail **app password**, file mode 600). Typed with `nano`, never in chat.

Until that password file exists, "Forgot password?" tells people to ask their owner. Logs: `~/gpf/logs/mail.log`, and `pool-service/backups/mail.log` for your app.

## 10. Addresses and the Cloudflare Tunnel

- Today each business needs one public hostname in the tunnel (section 4, step 2).
- **Optional, for many businesses:** a wildcard. Add public hostname `*.evolutiondfw.com` → HTTP `localhost:8080`, kept **below** the `poolapp`, `ntfy` and `gpf` entries, plus a DNS record `*` (CNAME to the tunnel, proxied). Then every new business works with no Cloudflare step. Named hostnames always win over the wildcard, so your own app is unaffected.
- **Why not `<name>.gpf.evolutiondfw.com`?** Cloudflare's free certificate covers only one level (`*.evolutiondfw.com`). A second level needs Cloudflare's paid Advanced Certificate Manager. A product domain of your own later (for example `<name>.greatpoolfriend.com`) is the clean long-term answer: set `GPF_DOMAIN` in `~/.config/gpf/kit.env` before the businesses are created.

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

## 14. Moving to the home lab (before July 2027)

The kit was built for this move: on the new server, install Docker, set `default-address-pools` in `/etc/docker/daemon.json`, copy `~/autodidact`, `~/gpf`, `~/.config/gpf` and `~/.config/pool-mail`, run `bash gpf/tenant.sh edge-up`, start each business, point the tunnel there, and install the cron jobs. Claude does the move when the server is ready.

## Support

Claude, in the Claude app (Remote Control on this server).
