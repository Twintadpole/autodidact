# Great Pool Friend: tenant kit

One copy of the pool app per business ("tenant"). Each tenant gets its own containers, its own
MongoDB with its own passwords, its own sealed network, folders, address and backup key. Built and
tested on the VPS in throwaway containers; it moves to the home lab later. The live
`pool-service` stack doesn't use it.

```
edge (gpf-edge network)        Traefik ── routes <name>.<domain>; joins each tenant network
                               dockerproxy ── read-only Docker view for Traefik (own internal network)
                               notice ── 503 "paused" page for suspended tenants
tenant network (internal)      one per tenant: its app + its Mongo. No internet, no host ports,
  gpf-t-<name>                 no other tenant. Admin jobs (backups, counts) join it briefly.
```

## Files

| Path | What |
| --- | --- |
| `tenant.sh` | Every command (below) |
| `lib.sh` | Settings and helpers |
| `templates/tenant.compose.yml` | One tenant: `mongo` (password login, replica set with key file, 0.25 GB cache, 640 MB cap) and `api` (384 MB cap) |
| `mongo/10-app-user.js` | First start: the app's own database user (read/write on `pool` only) |
| `edge/compose.yml`, `edge/notice.cjs` | Traefik v3.6, Docker socket proxy (no write access), the notice page |
| `test/run.sh` | The throwaway test (86 checks) |
| `test/import-roundtrip.sh` | Customer import between two tenants (12 checks) |

## Commands

```bash
bash gpf/tenant.sh build                     # image gpf-api:<commit> from pool-service/
bash gpf/tenant.sh edge-up
bash gpf/tenant.sh create <name> [owner-email]   # → https://<name>.<GPF_DOMAIN>
bash gpf/tenant.sh list                      # state, health, techs this month, image, last backup
bash gpf/tenant.sh users <name> [YYYY-MM]    # its logins and who was active that month
bash gpf/tenant.sh billing [YYYY-MM]         # active techs and the monthly price per tenant
bash gpf/tenant.sh owner-password <name>     # new temporary owner password (to the file; devices signed out)
bash gpf/tenant.sh update <name|all> [image] # backup, counts, new image, health, counts; stops at the first failure
bash gpf/tenant.sh backup <name|all>         # nightly (cron): dump + offsite; one failure doesn't skip the rest
bash gpf/tenant.sh restore-check <name> [--offsite local|r2]
bash gpf/tenant.sh export <name>             # exports/<time>/everything.xlsx + photos.zip
bash gpf/tenant.sh suspend|resume <name>
bash gpf/tenant.sh delete <name> --confirm <name>
bash gpf/tenant.sh purge <name-time> --confirm <name-time>
```

- **Logins:** the owner's login is the email given to `create` (else "owner"); their first password is
  temporary (they choose their own at the first login). They add their techs in the app (Team).
  **billing** counts a tech when their login was used that month (owners are free) and prices it:
  $75 covers 1–3 techs, then 4–5 $20 each, 6–15 $18, 16–30 $15, 31–50 $12, 51–75 $10, 76+ $8.
- **create** makes the secrets, all random: Mongo root and app passwords, key file, session secret,
  restic key, and the owner's first app password (kept in a file, never printed). It also gives the
  tenant a free /27 subnet of `GPF_SUBNET_BASE` (10.213.x.x), so Docker's address pools never run out.
  On the home lab also set `default-address-pools` in `/etc/docker/daemon.json` (that restarts Docker).
- **suspend**: the edge answers 503 "paused" for that address (the phone app keeps unsent work
  and retries on 5xx), and the app stops. The database, data and nightly backups carry on.
  `export` still works: it starts the app just for the export.
- **delete** needs an export from the last 24 hours and the name typed again. It makes a final
  backup (local and offsite), then removes the containers, the network and the live data. It keeps
  the dumps, the exports and the offsite copies, with their key, in `deleted/<name>-<time>/`.
- **purge** removes those kept copies, and is refused until `GPF_PURGE_DAYS` (90) have passed.

## Settings (environment)

| Variable | Default | |
| --- | --- | --- |
| `GPF_DOMAIN` | (required) | tenant address = `<name>.<GPF_DOMAIN>` |
| `GPF_ROOT` | `~/gpf` | `tenants/<name>/{data,backups,exports}`, `deleted/` |
| `GPF_CONFIG` | `~/.config/gpf` | secrets per tenant (700/600), chosen image, edge routes |
| `GPF_EDGE_BIND` | `127.0.0.1:8080` | Traefik; cloudflared connects here (or joins the edge network) |
| `GPF_PREFIX` | `gpf` | Docker names; the test uses `gpft` |
| `GPF_OFFSITE_LOCAL` | — | folder with a restic repository per tenant |
| `GPF_R2_ENV`, `GPF_R2_BUCKET`, `GPF_R2_PREFIX` | —, —, `gpf` | R2: `<bucket>/<prefix>/<name>` |
| `GPF_PURGE_DAYS` | `90` | |

Every tenant's backups are encrypted with its own key (`<secrets>/restic-password`). Keep a copy
of each key off the server: without it, that tenant's offsite copies can't be read.

## Test

```bash
GPF_PREFIX=gpft GPF_ROOT=/var/tmp/gpft GPF_CONFIG=/var/tmp/gpft/config bash gpf/tenant.sh build   # once per version
bash gpf/test/run.sh          # local offsite folder only
bash gpf/test/run.sh --r2     # also R2, under pool-backup/gpf-test/ (removed again at the end)
bash gpf/test/run.sh --clean  # leftovers after a failed run
bash gpf/test/import-roundtrip.sh   # customer import: tenant alpha's export into blank tenant bravo
```

It creates tenants `alpha` and `bravo` and checks:
- routes, and logins that only work on their own tenant
- the owner's email login and temporary password, a tech who can't see invoices, `users`, `list`,
  `billing` (also while a tenant is suspended), `owner-password` signing the owner's devices out
- data kept apart, no host ports, and no reaching the other tenant's database or the internet
- database logins, private secret files
- backups and restore checks (local and R2), and that one tenant's key can't read another's backups
- update, suspend and resume, export, delete and its refusals, purge and its 90-day refusal

Finally it confirms the live app's containers weren't restarted and its record counts are unchanged.

## Not in this kit yet

- cloudflared and the wildcard hostname (home lab)
- a monitor entry per tenant
- a cron line for `backup all`
- restoring a tenant from a backup (only restore-check so far)
- read-only suspend
- product branding (new tenants already start with blank business details; the app's name and icons are still the pool app's)
