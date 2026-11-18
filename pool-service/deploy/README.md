# Deploying to the VPS

The app runs with Docker Compose on the VPS, as the `claude` user, in `~/autodidact/pool-service`. Cloudflare Tunnel (`cloudflared` running on the host, managed from the Cloudflare dashboard) forwards **https://poolapp.evolutiondfw.com** to `http://localhost:3000`. The API listens only on `127.0.0.1:3000`, and MongoDB only on `127.0.0.1:27017`.

| Script | When | What it does |
| --- | --- | --- |
| `bootstrap-claude-user.sh` | Once, as root, on a fresh VPS | Creates the `claude` user (sudo), sets up the firewall and swap, installs Claude Code, clones the repo |
| `install-docker.sh` | Once: `sudo bash deploy/install-docker.sh` | Docker Engine and the compose plugin (Docker's repo, or Ubuntu's packages as a fallback); adds `claude` to the docker group |
| `first-deploy.sh` | Once: `bash deploy/first-deploy.sh` | Builds the image, writes `.env` with a fresh session secret and a random app password (printed once and saved to `~/pool-app-initial-password.txt`; delete that file once the owner has set their own password), starts the stack, installs the nightly backup |
| `update.sh` | After each new version | Safety backup first, then `git pull` and rebuild/restart; compares record counts before and after and fails loudly if anything is missing. Data and `.env` are kept |
| `cleanup-orphans.sh` | One-time (Nov 2026) | Lists visits, issues, notes and photos left under already-deleted pools/customers; `--apply <count>` hides exactly those (soft delete, after a safety backup). New deletes cascade on their own |
| `restore-check.sh` | Any time (safe) | Restores the newest backup into a scratch database, compares it with the live one, then deletes the scratch copy. `--offsite` does the same with the newest R2 copy, after reading every byte of it (weekly, Sundays 04:47 UTC, cron, logs to `backups/restore-check.log`) |
| `monitor.sh` | Cron (see "Alerts") | Phone alerts: app down (10 min), disk over 80%, nightly backup / R2 copy / weekly restore check late or failed. One alert per problem, one "OK again" |
| `set-password.sh` | Any time | Changes the app password (prompts twice; or `echo 'pw' \| bash deploy/set-password.sh -`) |
| `backup.sh` | Nightly at 03:17 (cron), or by hand | `mongodump` to `backups/pool-<time>.archive.gz`, keeps the newest 14, writes `backups/LAST_BACKUP`. Then sends that dump and all photos to Cloudflare R2, encrypted (see below), and writes `backups/LAST_OFFSITE`. `backup.sh predeploy` (run by `update.sh`) keeps its own newest 10 and stays local |

Useful commands, run from `~/autodidact/pool-service`:

```bash
docker compose ps
docker compose logs -f api
curl -s http://127.0.0.1:3000/api/health
```

**End-to-end check (phone-size browser, against the live app):** creates and then hides its own "E2E test" customer.
The public URL's API is behind Cloudflare Access, so run on the VPS against `http://127.0.0.1:3000/`.
No password is stored for the tests: `server/dist/cli/e2e-session.js` makes a 30-minute app session, and
`e2e/local-cookies.cjs` starts each test browser with it (and answers the login screen itself).

```bash
S=$(docker compose exec -T api node server/dist/cli/e2e-session.js)
sudo docker run --rm --network host -e E2E_SESSION="$S" -v "$PWD/e2e:/e2e:ro" -v /tmp/e2e-out:/out mcr.microsoft.com/playwright:v1.56.1-noble \
  bash -c 'cd /tmp && npm i -s playwright@1.56.1 >/dev/null && NODE_PATH=/tmp/node_modules NODE_OPTIONS="--require /e2e/local-cookies.cjs" \
  node /e2e/visit-extras.cjs http://127.0.0.1:3000/ unused /out'
```

`e2e/export.cjs` also opens the Excel files it downloads: install `exceljs@4` next to Playwright
(`npm i -s playwright@1.56.1 exceljs@4`).

**Restore a backup:**

```bash
docker compose exec -T mongo mongorestore --drop --archive --gzip < backups/pool-<time>.archive.gz
```

Photos (`data/photos`) aren't in the local dumps; they are in the offsite copies.

## Offsite backups (Cloudflare R2)

Every night, `backup.sh` sends the database dump and `data/photos` to the R2 bucket `pool-backup` with
[restic](https://restic.net) (Docker image `restic/restic:0.18.1`). restic encrypts everything on this
server before upload. It keeps 14 daily, 8 weekly and 12 monthly copies. If the offsite step fails, the
local backup is kept, the script exits 2, and `backups/backup.log` says `OFFSITE BACKUP FAILED`.

Keys live in `~/.config/pool-backup/` (folder 700, files 600), never in git:

| File | What |
| --- | --- |
| `r2.env` | `R2_ENDPOINT` (the bucket's S3 API address), `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (an R2 API token with Object Read & Write on `pool-backup` only) |
| `restic-password` | The encryption key. **The owner keeps a copy off this server** (password manager): without it, nobody can read the R2 copies |

Helper in `lib.sh`: `restic_ [docker run options] -- <restic command>`, e.g.

```bash
source deploy/lib.sh
restic_ -- snapshots              # list the copies in R2
restic_ -- check --read-data      # prove every byte is readable
```

**If this server is lost:** on a new server, set up the app (`first-deploy.sh`), put `r2.env` and
`restic-password` back in `~/.config/pool-backup/`, then:

```bash
source deploy/lib.sh
restic_ -- dump latest /data/db.archive.gz | docker compose exec -T mongo mongorestore --drop --archive --gzip
restic_ -v "$PWD/data:/restore" -- restore latest --target /restore --include /data/photos   # → data/data/photos
# then move data/data/photos/* into data/photos and: sudo chown -R 1000:1000 data/photos
```

## Alerts (self-hosted ntfy)

The `ntfy` service in `docker-compose.yml` (image `binwiederhier/ntfy:v2.15.0`, data in `data/ntfy`)
listens on `127.0.0.1:2586`. The Cloudflare Tunnel publishes it as **https://ntfy.evolutiondfw.com**.
Logins are required for everything (`deny-all`, no sign-up, no web app):

| Account | Access | Secret |
| --- | --- | --- |
| `owner` | read `pool-alerts` (the ntfy Android app) | `~/.config/pool-alerts/ntfy-owner-password` |
| `monitor` | write `pool-alerts` | token in `~/.config/pool-alerts/ntfy-token` |

`monitor.sh` posts to ntfy locally, so alerts don't depend on the tunnel. Cron (user `claude`):

```
*/5 * * * *  monitor.sh app       public site health; alert after 2 failures in a row; says whether the
                                  app, the database or the tunnel is at fault
7 * * * *    monitor.sh disk      alert when / is over 80% full
17 5 * * *   monitor.sh backups   nightly backup or R2 copy older than 26 h, or no passing R2 restore check in 8 days
@reboot      monitor.sh boot      2 min after a restart: phone report (containers healthy, site reachable)
```

Log: `backups/monitor.log`. Open problems: `~/.local/state/pool-monitor/*.down`. Send a test: `bash deploy/monitor.sh test`.

**Whole server down:** nothing on the server can report that. Cloudflare's "Tunnel health" notification
(dashboard → Notifications) emails the owner when the tunnel disconnects.

Manage ntfy accounts: `docker compose exec ntfy ntfy user list` (see `ntfy user --help`, `ntfy access --help`).

## Cloudflare Access (emailed-code login)

Access (Cloudflare Zero Trust → Access → Applications) sits in front of the API of `poolapp.evolutiondfw.com`.
The app's own files (screens, icons, service worker) stay open: they hold no data, and the phone must be
able to download app updates even while its Access login has expired.

| Access application | Policy | Why |
| --- | --- | --- |
| `poolapp.evolutiondfw.com/api/*` (app "Pool app") | **Allow**: the owner's email, login method One-time PIN; session 30 days | all data and the app's own login |
| `poolapp.evolutiondfw.com/api/health` (app "Pool app – open paths") | **Bypass**: Everyone | `monitor.sh app` (every 5 min) and the boot report |
| `poolapp.evolutiondfw.com/manifest.json`, `/icons/` | **Bypass**: Everyone | the home-screen app (browsers fetch these without cookies) |

`ntfy.evolutiondfw.com` is **not** behind Access (the ntfy app can't do the login; it has its own).

When the Access login expires, API calls get a redirect to Cloudflare instead of an answer. The app
(`client/src/offline/access.ts`) uses `redirect: 'manual'` to spot it, keeps the outbox waiting, and
shows "Cloudflare login needed · Log in again", which opens `/api/access-login`: Cloudflare's login,
then the server sends the browser back to `/`. The service worker never serves the app for
`/cdn-cgi/` pages: Cloudflare saves its login at `/cdn-cgi/access/authorized`. Test: `e2e/access-expired.cjs` (simulated).

Live e2e checks run against `http://127.0.0.1:3000/` on the VPS (not through Cloudflare).

## SSH (keys only)

`/etc/ssh/sshd_config.d/00-hardening.conf` (read before cloud-init's `50-cloud-init.conf`; sshd keeps
the first value): password and keyboard-interactive logins off, root by key only
(`PermitRootLogin prohibit-password`), `MaxAuthTries 3`, `LoginGraceTime 30`, `X11Forwarding no`.
Nothing automated logs in over SSH; this Claude session (Remote Control), the tunnel, backups and
alerts all connect outward or run locally.

Keys in `/root/.ssh/authorized_keys`, one line per device, labelled at the end (`phone-termux`, …).
**Add a device:** on it, `ssh-keygen -t ed25519 -C "<device-name>"`, then append its **public** key
(`~/.ssh/id_ed25519.pub`) to that file from a logged-in session:
`echo '<public key line>' | sudo tee -a /root/.ssh/authorized_keys`. Remove a lost device by deleting its line.

**Locked out?** Use the hosting provider's web console, then
`sudo rm /etc/ssh/sshd_config.d/00-hardening.conf && sudo systemctl reload ssh` brings password logins back.
