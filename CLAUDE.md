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
  - never print the password
  - stop and report on any failure
- VPS sessions may refuse widened production writes that are relayed from another session. That's correct: ask the owner to confirm in that VPS session.
- App folder: `~/autodidact/pool-service`. The app password is in `~/pool-app-initial-password.txt` (the owner has it).
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
4. e2e against the public URL. Login limit: 5 per 15 min, so run at most 4 tests per deploy.
5. dry run of `cleanup-orphans.sh`, then `record_counts`

## Next up (owner's roadmap)
- **Phase 6, hardening** (needs the owner's approval of a plan first):
  - encrypted offsite backups to Cloudflare R2 (owner creates a bucket and token, about 2 minutes)
  - uptime and disk-space alerts
  - Cloudflare Access login
  - SSH lockdown
  - delete `~/pool-app-initial-password.txt` once the owner has changed the password
  - plan the move off Ubuntu 26.10 (short support) to 26.04 LTS
  - optionally set Remote Control back to asking permission
- **Phase 7:**
  - desktop layout
  - fuller customer records: service plan and price, equipment per pool
  - money tools: income, payments, expenses, mileage, profit and loss, profit per customer
  - **simple PDF invoices**
  - CSV/Excel import and export
- **Ideas the owner liked or may want:** chemical cost per dose, recurring maintenance reminders, dosing calculator, customer service reports (needs the owner's OK).
