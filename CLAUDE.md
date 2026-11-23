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
- **No deploys until the owner says so (Nov 20).** Build and test in throwaway environments only; commit and push,
  but don't run `deploy/update.sh` or touch the live stack until the owner explicitly asks for a deploy.
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

## Where we left off (Nov 22)
- Everything since v0.2.0 is built and tested but **NOT deployed** to the owner's app (owner's rule: no deploys
  until they say so): GPF tenant kit, customer import, accounts/roles/routes, branding, six languages.
- The owner tests on **https://gpf.evolutiondfw.com** (test install, dummy data; see "GPF test install" below).
- **Beta checklist (owner approved Nov 22, "go as suggested"; order 1, 3, 2, 5, 4):**
  1. ✅ Safety net (built Nov 22): `gpf/monitor.sh` (health every 5 min through the edge, backups daily,
     disk hourly; ntfy via `GPF_NTFY_URL`/`GPF_NTFY_TOKEN_FILE`; per-tenant `backups/MONITOR_STATUS` for the
     System card), `restore-check all --offsite`, `tenant.sh cron [--install]`. Kit test 111/111. Installed in
     user `claude`'s crontab for the test install (between `# gpf-kit begin/end`); logs `~/gpf/logs/`. Test install
     alerts go to ntfy topic **gpf-alerts** (owner OK'd Nov 22: `ntfy access monitor gpf-alerts write-only`,
     `owner … read-only`; auth.db copy `data/ntfy/auth.db.bak-20261122`); kit.env has GPF_NTFY_URL/TOKEN_FILE.
     Owner's app: Mongo health check 30s (start 2s) in `pool-service/docker-compose.yml`, deploys with the next deploy.
  3. ✅ Help + feedback + errors + Beta label (built Nov 22, not deployed): `lib/help.ts` (15 topics, texts in
     h(); `screens` = route names for the header "?"), `HelpPage` (/more/help/:topic?, /desk/help), `FeedbackPage`
     + `lib/feedback.ts` (offline queue in localStorage), `boot/errors.ts` → `/client-log` → `clientErrors`
     (counted, TTL 60 d), `feedback` collection (`/feedback` GET/POST/PATCH), `server/test/feedback.test.ts`,
     `e2e/help-feedback.cjs` (9; clears the owner's language at the end). Operator: `tenant.sh feedback|errors`,
     `monitor.sh feedback` hourly alert. Kit test 115/115; all 19 e2e scripts pass. Help mentions an "Invite"
     button on Team that segment 2 adds.
     VPS test recipe used: `/var/tmp/pst.sh '<cmd>'` (node:22 on a /var/tmp/pstest copy), scratch mongo
     `pst-mongo` :27099, API `pst-api` :3300 with `/var/tmp/pst-beta.env` (password in `/var/tmp/pst-beta.pw`),
     `/var/tmp/pw-run.sh <script>` / `/var/tmp/pw-all.sh` (restarts the API every 4 scripts; login limit).
  2. ✅ Onboarding (built Nov 22, not deployed): Team → Invite (navigator.share, else copy), `WelcomeDialog`
     (after a forced password change: `lib/welcome.ts` queueWelcome/welcomeOpen), `GettingStartedCard` (owners;
     Route + desk dashboard; hide per person per device), Help topic "Beta tester guide". Docs: `gpf/docs/`
     welcome-owner.md + beta-tester-guide.md → `tenant.sh welcome <name>` PDFs (make-pdf.cjs in the Playwright
     image). `e2e/onboarding.cjs` (5); accounts.cjs skips the welcome. All 20 e2e pass; kit 118/118
     (fixed a race: create/update now wait up to 30 s for Traefik to route a restarted app, `t_edge_code`).
  5. ✅ Translation review (built Nov 22): `npm run i18n:review -- export [codes] --out <dir>` (per language
     xlsx: "How to review" + "Texts": hidden Key/Form, English, Translation now, Your correction, Comment, Where)
     and `-- import <code> <file> [--dry-run]` (refuses changed {placeholders}; a plural form may drop {n};
     lists comments). Sheets for the owner in `~/translation-review/` on the VPS with translator-guide.pdf
     (`gpf/docs/translator-guide.md`, `tenant.sh docs`). Owner finds reviewers; returned files → dry run →
     show the owner → import → i18n:check → drop "beta" for that language when fully reviewed.
  4. ✅ Password reset by email (built Nov 22, not deployed): `routes/passwordReset.ts` (/auth/options, /auth/forgot,
     /auth/reset; token sha256 in `passwordResets`, 30 min, one use, 3/h per login; notice without link to other
     owners), `services/mail.ts` (queue in `mailOutbox`, raw without From), `ForgotPage`/`ResetPage`/`PublicCard`.
     Sender: `deploy/mail-lib.sh` (curl SMTP, password via -K fd; writes backups/MAIL_READY) used by
     `deploy/mail.sh` (owner app) and `tenant.sh mail` (docker exec into each tenant mongo; cron every minute).
     Mailbox config `~/.config/pool-mail/mail.env` (made Nov 22: twintadpole@gmail.com) + `gmail-app-password`
     (**owner still to create** with nano). PUBLIC_URL in docker-compose.yml + tenant template.
     **At the owner's deploy: add the cron line for deploy/mail.sh** (deploy/README.md "Email").
     Tests: reset.test.ts 7, e2e/password-reset.cjs 4 (Mailpit `axllent/mailpit:v1.27`, MAILPIT env), kit 127/127.
  6. ✅ Docs (built Nov 22): Terms + Privacy in the app (`client/src/legal/*.md` → `LegalPage`, /terms, /privacy,
     public; `lib/markdown.ts`), operator guide `gpf/docs/operator-guide.md` (the owner's complete runbook), PDFs via
     `tenant.sh docs` in `~/gpf/docs/` (make-pdf.cjs now does tables). `e2e/legal.cjs` (3).
  7. ✅ Restore (built Nov 23, owner: "start on that"): `tenant.sh restore <name> [--file|--offsite local|r2
     [--snapshot id]] [--no-photos] (--dry-run|--confirm <name>)`, `tenant.sh snapshots`. Scratch check, safety dump
     `pool-prerestore-*` (local only, 10 kept), api stopped, mongorestore --drop, `serverMeta {_id:'restore', at}` →
     every phone's next pull is full (sync.ts, owners too; sync.test.ts), offsite: missing photos added back
     (file by file; busybox cp -n skips existing folders), undo command printed, `backups/RESTORES` log.
     Owner's own app has no restore command yet (deploy/restore-check.sh only).
     Shortcut `~/.local/bin/gpf` (host only) = tenant.sh; the owner (Termux = root) runs `sudo -iu claude gpf list`.
  8. ✅ Domain move (Nov 23, owner bought greatpoolfriend.com, on Cloudflare): kit.env `GPF_DOMAIN=greatpoolfriend.com`,
     `GPF_ALIAS_DOMAINS=evolutiondfw.com` (old addresses kept during the move; kit.env.bak-20261123). New test
     business **demo** (owner@demo.example, seeded 14 customers); gpf to be retired later (owner: "demo is better").
     Support address **support@greatpoolfriend.com** (owner sets Cloudflare Email Routing). Owner still to add the
     tunnel wildcard `*.greatpoolfriend.com` → localhost:8080 and check Zaraz is off there. Kit test 155/155.
  - ✅ **Security hardening built Nov 23** (owner: "Go"): `plugins/securityHeaders.ts` (CSP script-src 'self', no inline
     scripts; style 'unsafe-inline' for Quasar; img data:/blob:; frame-ancestors none; HSTS; nosniff; XFO DENY;
     Referrer same-origin; Permissions-Policy), `.max()` on every text field + list caps (shared schemas), logo
     data URL only png/jpeg/webp/gif (or empty), photos re-encoded by sharp in `PhotoStore.place` (real image or
     400 "A photo file is not a picture"; EXIF/GPS dropped), `npm audit fix` (@fastify/static 10.1.12), 2 moderate
     left (exceljs→uuid, unused v3/v5/v6), `monitor.sh audit` monthly cron. `test/security.test.ts`;
     `e2e/csp-watch.cjs` preload fails any e2e run with a CSP block (used by /var/tmp/pw-run.sh).
     Operator guide 13b: Cloudflare settings for the owner (Always HTTPS, TLS 1.2, Free Managed Ruleset,
     rate limit /api/auth/ 10/min, Bot Fight Mode off, Zaraz off, no Access on tenants).
  - (Plan as proposed Nov 23:) security headers (CSP/HSTS/frame/nosniff),
     max lengths on ~47 unbounded text fields, uploads verified as images + GPS/EXIF stripped, npm audit monthly,
     Cloudflare settings for the owner (WAF free rules, Always HTTPS, TLS 1.2, rate-limit /api/auth). Told the
     owner: no character bans (Unicode names); no Cloudflare Access per business; owner 2FA could come later.
  - Tenant addresses (before the move): `<name>.evolutiondfw.com` (Cloudflare's free cert covers one level; `<name>.gpf.…` would need
    Advanced Certificate Manager). gpf.evolutiondfw.com = tenant `gpf`, the owner's test/demo business ("test
    branch": `update gpf` first, then `update all`). Owner Nov 22: the tunnel already routes gpf; they'll probably
    run real tenants on this setup. Each tester: a tunnel public hostname (or a `*.evolutiondfw.com` wildcard).
    Room on this VPS: ~4–6 beta tenants (~230 MB each).
  - Owner also asked (Nov 22) for a **docs + onboarding plan**: in-app Help, owner onboarding, beta tester guide,
    terms/privacy. Owner's answers: legal line **"Great Pool Friend. Created by S R Donaldson, all rights
    reserved."**; support contact **steven@evolutiondfw.com**.
- **Owner's login (decided Nov 22): steven@evolutiondfw.com** (password unchanged; they keep it in a password
  manager). The owner adds `OWNER_EMAIL=steven@evolutiondfw.com` to `pool-service/.env` themselves (we never edit
  .env); check `grep -c ^OWNER_EMAIL pool-service/.env` before the deploy. The first start with accounts makes
  that login. Deploy only when the owner says so.

## Session handoff (Nov 18)
- The cloud ↔ VPS bridge described above was not used in the Nov 14–18 sessions: the owner talked to Claude
  running ON the VPS (Remote Control, user `claude`, `~/autodidact`), which built, tested and deployed directly.
- How work was tested there: a throwaway copy (`rsync` to `/var/tmp/pstest`; **not /tmp**, which is a 1.7 GB RAM disk on
  this VPS: filling it starves the live app and Mongo there reports OutOfDiskSpace), `node:22` container for typecheck/tests,
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
  (72 checks, throwaway `gpft-*` under /var/tmp; `--r2` uses pool-backup/gpf-test/ and removes it). Owner's
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
  - ✅ Segment 3 Nov 20: `gpf/test/import-roundtrip.sh` (fill tenant alpha → `tenant.sh export` → import into blank
    bravo; every field matches; re-import = nothing; Undo empties bravo; live untouched). Found and fixed: pools
    at stop #0 were "updated" on every re-import. **Import is complete in test; NOT deployed** (owner: no deploys
    until told).
  **GPF item 3, user accounts + roles** (plan approved Nov 20 with changes): login = **email** + password; roles
  owner / tech (tech: no money, no deletes of customers/pools, no business settings/import/export/team);
  techs **may send recaps**; **assigned routes now**: `pools.techId`, a tech's phone gets only their pools
  (+ those customers, visits, issues, photos, notes; customers they added); moving a pool → that tech's next
  pull is `full` and the phone replaces its copy. Server prices a tech's doses (dose pricing moved to shared).
  First start: `ADMIN_PASSWORD_HASH` becomes the first owner, login name `OWNER_EMAIL` or "owner";
  old sessions map to that owner.
  - ✅ Segment 1 (server) built Nov 20, NOT deployed: `models` User (+ pools.techId, customers.createdBy,
    auditLog.userId), `services/users.ts`, `services/scope.ts`, `plugins/auth.ts` (request.actor, requireOwner,
    preValidation), `routes/auth.ts` (login, me, password, devices), `routes/team.ts` (team, reset, `/pools/assign`),
    crud `techAccess/techBody/afterWrite`, scoped sync pull/package, `cli/users.ts`, `deploy/set-password.sh`
    updates the owner login, `test/roles.test.ts`. Until segment 2 the app's login screen can't log in (it sends
    no email).
  - ✅ Segment 2 (app) built Nov 20, NOT deployed: email login (`type=text`: "owner" must be accepted),
    `lib/session.ts` (phone copy belongs to one user; cleared on a new login, asks if unsent), `AccountPage`,
    `TeamPage` (route picker), owner-only route meta, money/delete/history hidden for techs, Route tech
    filter, pool form tech picker, full pull replaces local tables. All e2e scripts fill Email (`E2E_EMAIL`,
    default "owner"); `local-cookies.cjs` answers login with the session's `me`. `e2e/accounts.cjs` (8) runs
    only in a test env (real logins). Login limit 5/15 min: restart the test API between batches of 4 scripts.
  - ✅ Segment 3 (tenant kit) built Nov 20: `tenant.sh create <name> [owner-email]` (OWNER_EMAIL in api.env,
    first password temporary), `users`, `billing` (graduated tiers, `price_for`), `owner-password`, TECHS in
    `list`; `cli/users.js table` and `set-password --temporary`. Kit test 86/86, import round trip 12/12.
    **GPF item 3 is complete in test; NOT deployed.**
  ✅ **GPF item 4, branding** (owner Nov 20: product name Great Pool Friend on their own app too; placeholder
  icon; "Powered by" yes), built Nov 20, NOT deployed: `PRODUCT_NAME` (default Great Pool Friend),
  `services/branding.ts` (server writes /manifest.json from Business details; icons from the logo at
  /icons/business/<sha>-<size>.png), `lib/branding.ts` (login/header/footer, cached), placeholder icons from
  `client/scripts/make-gpf-icons.mjs`, Workbox `extendPWAInjectManifestOptions` ignores manifest.json,
  `e2e/branding.cjs` (test env only), kit test 91/91. On the owner's app /manifest.json and /icons/* are
  already open in Cloudflare Access, so the login screen can read them.
  **GPF test install running on the VPS (Nov 20, owner: dummy data, prove isolation; subdomain later):**
  `~/gpf` + `~/.config/gpf` (kit.env: GPF_DOMAIN=evolutiondfw.com, edge 127.0.0.1:8080, local offsite
  folder), image `gpf-api:a1a7db0` (Nov 23, hand ticks follow the login; mail cron on), tenants **gpf** (GPF Demo Pools, owner@gpf.example, 14 customers) and
  **bluewave** (Bluewave Pool Co, owner@bluewave.example, 9), dummy data from `gpf/demo/seed-demo.cjs`;
  `gpf/demo/verify.sh gpf bluewave` 31/31 (3 logins per tenant: wait 15 min between runs). Not public: the
  owner will add tunnel hostname gpf.evolutiondfw.com → http://localhost:8080 later. No backup cron for it.
  Measured idle: GPF containers ~565 MB (per tenant ~230 MB: api ~80, mongo ~150; edge ~110 MB), live
  stack ~280 MB, server used ~1.6 of 3.3 GB, ~1.8 GB available; disk 7 MB. Stop it: `docker compose -p
  gpf-t-<name> stop` per tenant, `docker compose -p gpf-edge stop`.
  **GPF item 5, languages** (owner Nov 22: US top 6 = en, es, vi, zh, tl, ar; translations by Claude marked
  "beta"; customer-language invoices/recaps later; the owner wants the app ready for testing and a bigger
  audience next). Design: own small translator `client/src/i18n/index.ts` (no vue-i18n): English text is
  the key (`t('…')`, `$t('…')`, `tn(n, one, other)`, `translated({...})`/`translatedOptions([...])` for label
  maps), dictionaries `client/src/i18n/<code>.json`, missing → English. Per-user `users.language`
  (PATCH /auth/me), device default from the phone, `LanguagePicker` on login + My account. Invoices,
  recaps, exports stay English (customer docs). **Rule: every new on-screen text goes through t()/$t()**;
  `npm run i18n:check` (client/scripts/i18n-keys.mjs; data-driven keys in i18n/extra-keys.json).
  - ✅ Segment 1 built Nov 22 (not deployed): all screens converted (~905 texts), es.json complete,
    `e2e/languages.cjs` 5/5, every English e2e still passes.
  - ✅ Segment 2 built Nov 22 (not deployed): vi, zh, tl, ar dictionaries complete (905 texts each; plural
    forms per language, Arabic 6, a plural form may omit {n}); right to left via `postcss-rtlcss` in
    client/postcss.config.js (dev dependency) + `<html dir>` set by setLanguage; languages.cjs 6/6, English
    e2e unchanged. App download 800 KB (before languages) → 911 KB gzipped with all six.
  - Later (owner): invoices and recaps in the customer's language; native-speaker review → drop "beta".
  Next GPF item: Mongo health check 5s → 30s on the owner's stack (tenants already 30s); then the plan doc's
  phase list (beta, paid launch, warm standby) — ask the owner.
    Before any deploy of this to the owner's app: OWNER_EMAIL=steven@evolutiondfw.com must be in .env (owner adds it).
  - Scratch Mongo for tests needs `--ulimit nofile=64000:64000` (1024 runs out with 9 test files).
  Later items, in order: customer/pool import, user accounts + roles, blank branding for new tenants,
  Mongo health check 5s → 30s (tenants already use 30s with a 2s start interval).
- **Ideas the owner liked or may want:** chemical cost per dose, recurring maintenance reminders, dosing calculator, customer service reports (needs the owner's OK).
