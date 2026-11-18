# Working notes for Claude (read first)

## Project
`pool-service/`: single-user, offline-first pool service PWA for the owner's Android phone.
- **Live:** https://poolapp.evolutiondfw.com
- **Release:** **v0.1.0-alpha**, commit `9edb091` on branch `claude/new-session-q17smb`
- **What the app does now:** `pool-service/README.md` and `pool-service/CHANGELOG.md`
- **Original spec:** the owner's "Pool Service App — Build Outline", plus their later edits:
  - visit cards: the current visit card, with the previous visit's card below it
  - issues have Completed and Postpone
  - visit timer with pauses and editable times
  - photos on issues
  - visit history by date

Stack:
- `shared/`: Zod schemas and `READINGS`
- `server/`: Fastify 5, Mongoose 9, MongoDB 8 replica set
- `client/`: Quasar 2 PWA, Dexie offline DB with an outbox, Workbox service worker
- `e2e/`: Playwright scripts

## How the owner wants to work
- **Plan each segment, ask for approval, then do it.** The owner approves segments in chat; don't change the server outside an approved segment. Bug fixes the owner reports may be fixed and deployed after a short "Deploy?" check.
- **The owner is not a go-between.** Claude does the server work itself, and the owner only approves.
- **Never lose customer data.** Changes are additive only. Every deploy uses `deploy/update.sh`, which takes a backup first and compares record counts before and after. Report the counts to the owner.
- **Keep messages to the owner short and plain.** They work from a phone (Termux, the Claude app).

## How server work is done (VPS, Ubuntu 26.10, user `claude`)
- This cloud session can't SSH. It starts sessions on the VPS with `create_session` (claude-code-remote) on the bridge environment **`env_01AxCrX2TXpwcs8bfzcrJL4L`** ("VuDSONtemp:autodidact"). Then it reads results with `list_events` (kinds `["result"]`).
  - The VPS runs `claude remote-control --permission-mode bypassPermissions` in tmux, in `~/autodidact`.
- Give the VPS session exact, numbered steps and the safety rules every time:
  - never drop or reset data
  - never run `first-deploy.sh` or `cleanup-orphans.sh --apply`
  - never edit `.env`
  - never print secrets (keys, tokens, session cookies)
  - stop and report on any failure
- VPS sessions may refuse widened production writes that are relayed from another session. That's correct: ask the owner to confirm in that VPS session.
- App folder: `~/autodidact/pool-service`. The app password is the owner's alone (set with `deploy/set-password.sh`); it is not stored on the server. Live tests log in with a 30-minute session from `server/dist/cli/e2e-session.js`.
- Cloudflare Tunnel (`cloudflared` running on the host, managed from the Cloudflare dashboard) points `poolapp.evolutiondfw.com` at `http://localhost:3000`.
- This sandbox's network blocks the live domain, so live checks run on the VPS (Playwright in a Docker container).

## Before every deploy (in this container)
1. `npm run typecheck`
2. Server tests: `docker compose up -d mongo`, then `MONGO_TEST_URL='mongodb://localhost:27017/?directConnection=true' npm test`
3. Build the client and run the e2e scripts against a local server:
   - `node --conditions=@pool/source --env-file=<env> --import tsx src/index.ts` with `CLIENT_DIST=client/dist/pwa`, `PORT=3300`
   - then `node e2e/<name>.cjs http://127.0.0.1:3300/ <pw> <outdir>` with `NODE_PATH=$(npm root -g)`
4. **Build the production Docker image.** The sandbox needs its proxy CA added to a temporary copy of the Dockerfile, built with `--network host`. Never commit that CA file.
5. Commit, then push to `claude/new-session-q17smb`. Pushing tags is blocked from here.

Then start the VPS session:
1. `git pull --ff-only`
2. `bash deploy/update.sh`
3. health check
4. e2e against `http://127.0.0.1:3000/` on the VPS with `E2E_SESSION=$(docker compose exec -T api node server/dist/cli/e2e-session.js)` and `NODE_OPTIONS=--require /e2e/local-cookies.cjs`; the password argument is `unused` (see `pool-service/deploy/README.md`). Login limit: 5 per 15 min, so run at most 4 tests per deploy.
5. dry run of `cleanup-orphans.sh`, then `record_counts`

## Commits made on the VPS
The VPS pushes to GitHub with a deploy key for this repository only (`~/.ssh/github_autodidact` of user
`claude`, write access; push URL `git@github.com:Twintadpole/autodidact.git`, fetch stays https).
Push VPS commits to `claude/new-session-q17smb` right after committing (never force, never `master`).

## Next up (owner's roadmap)
- **Phase 6, hardening** (needs the owner's approval of a plan first):
  - ✅ encrypted offsite backups to Cloudflare R2 (Nov 16): restic, bucket `pool-backup`, keys in `~/.config/pool-backup/` on the VPS. See `pool-service/deploy/README.md`
  - ✅ uptime and disk-space alerts (Nov 16): self-hosted ntfy + `deploy/monitor.sh` in cron; Cloudflare tunnel-health email for a whole-server outage
  - ✅ Cloudflare Access login (Nov 17): emailed code, 30-day session, locks `/api/*` only (app files stay open so updates download); open paths `/api/health`, `/manifest.json`, `/icons/*`; ntfy not behind Access. The app shows "Log in again" when it expires
  - ✅ SSH lockdown (Nov 17): keys only, root by key (`phone-termux`); the owner's workstation key comes later. See `pool-service/deploy/README.md` "SSH"
  - ✅ owner set their own app password (Nov 17); `~/pool-app-initial-password.txt` deleted; tests use e2e sessions
  - ~~move to a new 26.04 LTS VPS~~ declined (Nov 17). Instead, **before July 2027** (26.10 support ends), the owner
    moves everything to an Ubuntu server in their **home lab**: Docker containers on a Docker network / trunk
    network, **Traefik** in front, reached only through a **Cloudflare Tunnel** on the same Cloudflare domain.
    The owner builds the server; Claude moves the app when it's ready. Keep new work portable: config in env and
    `~/.config/…`, data in `data/`, no new host-only pieces where a container will do.
  - optionally set Remote Control back to asking permission
- **Phase 7** (owner's decisions, Nov 17; plan each segment for approval):
  - **Every field optional** (no forced entry). Billing is a **flat monthly rate per customer, chemicals included, no sales tax**; payments by check, cash and electronic.
  - ✅ **7A customer records** (deployed Nov 17): customer class **current / prospect / past**; billing fields; **distance from HQ** (miles, owner fills it; used by 7C); pool **equipment**: pump, filter, heater, salt cell/chlorinator, cleaner, automation, lights, timers, plus custom items, each with notes and optional photos.
  - ✅ **7B (deployed Nov 18):** business name and logo pre-filled; owner fills the rest.
    - **One-time service date** for a pool, as an alternative to a weekly service day (owner's addition).
    - Business details (More → Business): name, address, phone, email, **logo** (Evolution Home Solutions;
      original kept on the VPS at `~/branding/evolution-logo-original.png`), payment instructions, default
      terms, first invoice number. Defaults until the owner changes them: bill at the **start of the month**
      for that month, **due on receipt**, first number **1001**.
    - Chemical price per unit; doses keep the price at the time; cost shown to the owner only.
      **Invoices and recaps are built from an allow-list of fields; chemical costs must never appear.**
    - Monthly invoices (drafts for current customers with a rate), PDF made on the phone, shared via Android
      share; payments (check/cash/electronic/other, partial OK); Draft/Sent/Paid/Overdue/Void.
    - Visit recap (only when the owner chooses): date, tasks, readings, chemicals added (names and amounts,
      never cost), a separate note for the customer, ticked photos; sent via email link or share sheet.
  - **7C money tools:** income, payments, expenses, mileage (from distance-from-HQ), chemical cost per dose, P&L, profit per customer.
  - **7D desktop layout:** "some modular features, nothing too fancy" (ask what modular means before planning).
  - **7E** CSV/Excel import and export.
- **Ideas the owner liked or may want:** chemical cost per dose, recurring maintenance reminders, dosing calculator, customer service reports (needs the owner's OK).
