# Working notes for Claude (read first)

## Project
`pool-service/`: single-user, offline-first pool service PWA for the owner's Android phone.
- **Live:** https://poolapp.evolutiondfw.com
- **Release:** **v0.2.0** (Nov 18; tag `v0.2.0`), branch `claude/new-session-q17smb`. Previous: v0.1.0-alpha, `9edb091`
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
- **First check where you are.** If `hostname` is `VuDSONtemp` and the folder is `~/autodidact`, you ARE on the VPS
  (Remote Control). Work directly as in "Session handoff" below. Do NOT use `create_session`/`list_events`, which
  would only try to reach this same machine. The bridge steps below are only for a Claude running in the cloud.
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

## Session handoff (Nov 18)
- The cloud ↔ VPS bridge described above was not used in the Nov 14–18 sessions: the owner talked to Claude
  running ON the VPS (Remote Control, user `claude`, `~/autodidact`), which built, tested and deployed directly.
- How work was tested there: a throwaway copy (`rsync` to `/tmp/pstest`, `node:22` container for typecheck/tests,
  `docker build -f server/Dockerfile`, throwaway mongo + api on 127.0.0.1:3300), Playwright in
  `mcr.microsoft.com/playwright:v1.56.1-noble` with `E2E_SESSION` + `e2e/local-cookies.cjs`, then
  `deploy/update.sh`, live e2e on 127.0.0.1:3000, `cleanup-orphans.sh` (dry run), `record_counts`.
- Bug class seen twice: live (reactive) objects stored in IndexedDB fail silently. `commit()` and
  `putInvoices()` now store plain copies (`clone`); keep doing that for any new `db.*.put`.
- Owner still to do: business phone/email/address/payment instructions, rate per mile, monthly rates,
  distances, chemical prices. Later: a workstation SSH key (append its public key to root's authorized_keys).

## Remote Control auto-start (Nov 18)
- `~/.local/bin/start-remote-control.sh` (host only, not in the repo) starts `claude remote-control
  --permission-mode bypassPermissions` in tmux session `claude` (in `~/autodidact`). It always starts fresh: the
  old `--continue` was removed Nov 19 after it reopened an 11–13 MB chat and Remote Control hung (no session
  opened, the CLI just showed dots). Debug logs: `~/.local/state/remote-control-logs/` (last 10 kept). Run by user `claude`'s crontab `@reboot sleep 45 && …`; log in
  `~/.local/state/remote-control-boot.log`. Commit identity on the VPS: `-c user.name=Claude -c user.email=noreply@anthropic.com`.

## Open items after v0.2.0 (assessment, Nov 18)
- Data still blank in the app: monthly rates (0 of 11 customers), distances (0), chemical prices (0 of 11),
  business phone/email/address/payment instructions/rate per mile, equipment (0 pools). Money screens read $0 until filled.
- Ask the owner: do they hold a copy of `restic-password` off the server (without it the R2 backups can't be read)?
- Ideas raised, not approved: "log out everywhere" (lost phone), an alert when the server needs a reboot after
  updates, purge of the ~54 hidden E2E test customers on live (owner decision; never `cleanup-orphans.sh --apply`
  without approval), mileage purpose field for the IRS log.

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
  - ✅ **7C money tools** (deployed Nov 18): ledger (expenses incl. Tools = capital and Supplies = billed to the
    customer's draft invoice, other income, mileage as real miles per day), reports on the phone, and
    "what you earn per hour by customer" on the server (`/api/reports/customer-hours`): (billed − chemicals −
    2 × distance × rate per visit − linked expenses) ÷ hours; untimed visits use the pool's average.
  - **7C follow-up (approved Nov 18):** "per hour" is **per customer per month**: profit for the month (billed −
    the whole month's chemicals − mileage − expenses), ÷ the month's hours = average $/h; each visit's $/h =
    (month profit ÷ visits) ÷ that visit's time; current month "In progress", past months final. Shown on the
    Money screen (business side); year views list months.
  - ✅ **7C follow-up deployed Nov 18:** per-hour report is by month with each visit's $/h (`customerHours.ts`).
  - **7D desktop (approved Nov 18, "continue as suggested"):**
    - Owner's words: a dashboard of **cards** to show/hide, grow, shrink and open fullscreen; reactive sizing
      (big cards show tools to view, hide and format data; small cards show a few fields or part of a graph).
      The dashboard is for viewing and planning; the owner ALSO wants plain "accounting-style" screens
      (tables) for details and entering data. Phone app unchanged.
    - Owner's answers (Nov 18): first cards = today/week, money, owed, $/hour, chemicals, issues; the card
      layout **follows the owner** to any computer (store it on the server); the desktop view must be
      **selectable on the phone too** (done: More → Desktop view; it needn't work like the phone); ECharts OK.
    - Segments: (1) desktop shell + tables; (2) dashboard framework (show/hide, drag, resize S/M/L/full,
      fullscreen, saved layout, size-aware content via the card's real size) + the 6 cards above;
      (3) remaining cards + fullscreen tools (date range, filters, series/column toggles, number format,
      zoom into part of a chart, export). Charts: Apache ECharts (Apache-2.0). Dashboard history comes
      from the server; shows last loaded figures offline.
    - ✅ **Segment 1 built Nov 18** (`/desk/*`, `DeskLayout`, `components/desk/DeskTable` + `SidePanel`,
      `pages/desk/*`, `GET /api/reports/visits`, `e2e/desktop.cjs`). View choice per device in localStorage
      (`lib/view.ts`); column choice per table per device. The phone forms' fields were moved into shared
      components (`CustomerFields`, `LedgerFields`, `InvoiceEditor`) that the desktop panels reuse.
    - ✅ **Segment 2 built Nov 18** ("deploy ahead"): `pages/desk/DeskHomePage.vue`, `components/desk/DashCard` +
      `EChart` + `cards/*`, `lib/dashboard.ts`, `lib/chartTheme.ts` (data-viz reference palette, validated),
      `e2e/dashboard.cjs`. Layout = settings record `DASHBOARD_SETTINGS_ID` (…0002) with `dashboard.cards`
      [{id,size s/m/l/xl,hidden}], separate from business details. Per-hour and chemicals cards use the server
      and cache their last figures in localStorage (`useCachedReport`).
    - ✅ **Segment 3 built Nov 18** (owner: "go ahead"): cards water, pipeline, visitTimes, mileage, equipment,
      system; full-screen tools via `composables/useDashTools.ts` (provided only inside the full-screen dialog by
      `DashToolsScope`), card tables via `components/desk/CardTable.vue` (Columns + Export CSV). Visit-based
      cards share one download (`lib/visitsReport.ts`). `/api/system/status` reads `backups/MONITOR_STATUS`,
      written by `deploy/monitor.sh`. **7D is complete; next is 7E** (CSV/Excel import and export; plan first).
  - **7E CSV/Excel import and export** (owner's answers, Nov 18: nothing to import now, no visit-history import,
    chemical costs in exports yes):
    - ✅ **7E-1 exports deployed Nov 18:** Export (Excel/CSV) on every desktop table (`DeskTable`, column
      `exportType`/`exportValue`), full-screen card export, Export everything (`/api/export/everything.xlsx`,
      `services/exportWorkbook.ts`, exceljs). Excel needs the server; CSV is made on the device.
    - **7E-2 import, later, needs a plan:** the owner will scan supplier receipts/invoices for supplies and tools
      (all past ones), extract them to a sheet, and import them as expenses (Supplies, Tools = capital). Ask:
      one row per receipt or per item, which columns, receipt number field?
- **Multi-business product, Great Pool Friend (GPF)** (owner, Nov 19): host the app for other solo/small-crew pool
  techs. Plan doc: https://claude.ai/artifact/8d2UdqerJckMkGFgNLUNaK (owner approved its suggestions). Key points:
  one stack per business (own containers, Mongo, subdomain, secrets, backup key) on the home lab behind Traefik +
  Cloudflare Tunnel; `tenant.sh`; owner/tech roles later; Claude on a separate dev box, not production.
  Pricing: $75 covers 1–3 techs, then graduated per extra tech: 4–5 $20, 6–15 $18, 16–30 $15, 31–50 $12,
  51–75 $10, 76+ $8 (owner gave the tiers; amounts proposed Nov 19). Domain not chosen yet. Each phase: plan, then approval.
  Network design (owner's, decided Nov 19; matches their home lab): edge (cloudflared, Traefik, monitoring; all
  ingress/egress, no business logic) → admin trunk (admin tools; build/test/deploy, the only Docker control) and
  tenant networks: ONE `internal: true` network per tenant with its app + its Mongo; Traefik joins each tenant
  network (no shared tenant network); per-tenant Mongo user/password, no host ports; admin access = short-lived
  jobs joining one tenant; set Docker `default-address-pools` (small subnets) before the first tenant.
  ✅ **GPF item 1, tenant kit built Nov 19** (`gpf/`, see `gpf/README.md`). It has `tenant.sh`
  (build/edge-up/create/list/update/backup/restore-check/export/suspend/resume/delete/purge), the tenant
  compose template, the edge (Traefik v3.6 + read-only socket proxy + 503 notice), and `gpf/test/run.sh`
  (72 checks, throwaway `gpft-*` under /tmp; `--r2` uses pool-backup/gpf-test/ and removes it). Owner's
  choices: test backups both local and R2; suspend = offline with a notice; delete keeps a final backup
  **90 days**, then `purge`. Not in it yet: cloudflared/wildcard DNS, a monitor entry per tenant, a cron line
  for backups, a real restore command. Never run it against the live stack.
  **GPF item 2, customer & pool import** (plan approved Nov 19). Owner's rules: a row with no name is named by
  its phone, else its address; an existing customer is **merged** (blanks filled, new phones/notes/pools/
  equipment added; where both have a value and differ, the preview lists it and the owner picks per field,
  default keep stored); no sample files from other apps yet (column matching only). Undo hides what it
  added and restores what it changed, but keeps anything used or edited since.
  - ✅ Segment 1 (server) built Nov 19, not deployed: `routes/import.ts` (`/import/read|preview|apply`,
    `/imports`, `/imports/:id/undo`; the file is re-sent each step), `services/importRead|importClean|importPlan.ts`,
    `ImportLog` model (collection `imports`), shared `schemas/import.ts` (fields, `guessMapping`), `test/import.test.ts`.
    Reads the app's own Export everything back (round trip tested).
  - ✅ Segment 2 (desktop screen) built Nov 20, not deployed: `pages/desk/DeskImportPage.vue` (route `/desk/import`,
    button on Customers), `e2e/import.cjs` (6 checks; undoes its import, hides its customers).
  - Next: segment 3, round trip through the tenant kit (export one tenant → import into a blank one), then deploy.
  Later items, in order: customer/pool import, user accounts + roles, blank branding for new tenants,
  Mongo health check 5s → 30s (tenants already use 30s with a 2s start interval).
- **Ideas the owner liked or may want:** chemical cost per dose, recurring maintenance reminders, dosing calculator, customer service reports (needs the owner's OK).
