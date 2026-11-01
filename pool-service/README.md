# Pool Service

A single-user, self-hosted pool service PWA for an Android phone. It works offline at job sites and syncs when signal comes back.

- **Customers & pools:** contact records with tap-to-call / tap-to-navigate, notes and photos.
- **Visit cards:** the current visit's readings (FC, CC, pH, TA, CH, CYA, Salt, Phosphate, Temp) and doses in one card, with the previous visit's card below it.
- **Weekly service list:** every pool on the route with a checkmark once done this week, plus a manual **Reset week**.
- **Issues:** per-pool, with urgent/important flags (Eisenhower quadrants), photos, and **Completed** / **Postponed** actions.

Out of scope: invoicing, multiple users, customer-facing access.

## Status

| Phase | What | State |
| --- | --- | --- |
| 1 | Scaffold: monorepo, shared package, Docker Compose (Mongo replica set), PWA shell | ✅ done |
| 2 | Server core: models, auth, CRUD, chemical seed, `/sync/pull`, `/sync/package` (transactional, idempotent), tests | ✅ done |
| 3 | Online UI: login, Route, visit cards, Pool overview, Issues grid/list, Customers | next |
| 4 | Offline layer: Dexie, drafts, outbox, Background Sync, sync chip | |
| 5 | Photos: capture, compression, upload, sharp thumbnails, gallery | |
| 6 | Deploy: cloudflared, backups, Lighthouse PWA audit | |

## Layout

```
pool-service/
  shared/   @pool/shared  Zod schemas, READINGS constant, quadrant + ISO-week helpers (used by client and server)
  server/   @pool/server  Fastify 5 + Mongoose 9 API (Node 22)
  client/   @pool/client  Quasar 2 (Vue 3, Vite, Pinia) in PWA mode, Workbox InjectManifest
  docker-compose.yml       mongo (single-node replica set) + api
```

npm workspaces tie them together. In development the server and client use the shared package's TypeScript source directly (the `@pool/source` export condition and a Vite alias), so there's no watch step for `shared/`. Production builds compile it to `shared/dist`.

## Local development

Requirements: Node 22+, Docker.

```bash
cd pool-service
npm install

# 1. Database (single-node replica set, needed for transactions)
docker compose up -d mongo

# 2. Config
cp .env.example .env
npm run hash-password              # paste the hash into .env as ADMIN_PASSWORD_HASH='...'
openssl rand -hex 32               # paste into .env as SESSION_SECRET

# 3. Run the API (http://localhost:3000, auto-reloads)
npm run dev

# 4. In another terminal, run the PWA dev server (http://localhost:9000, proxies /api to :3000)
npm run dev:client
```

On first start the server creates the collections and indexes and seeds the chemical list.

### Tests

The server tests need MongoDB running as a replica set. Use the compose database:

```bash
docker compose up -d mongo
MONGO_TEST_URL='mongodb://localhost:27017/?directConnection=true' npm test
```

Without `MONGO_TEST_URL`, the tests start an in-memory replica set with `mongodb-memory-server`, which downloads a `mongod` binary on first run.

Every test file gets its own throwaway database. What they cover:

- applying a package (visit, issues, notes, photos, weekly checkmark) in one transaction
- **retries:** the same `packageId` sent again, or 4 copies at once, is applied exactly once and always returns 200
- rollback: a package with a bad chemical reference leaves nothing behind
- last-write-wins on `updatedAt`
- issue status timestamps (completed → `resolvedAt`, postponed → `postponedAt`, reopen clears both)
- Reset week beats an older offline checkmark that syncs late
- `/sync/pull` first pull vs. incremental pulls, including soft deletes
- auth: login, 90-day "remember this device", logout, 401 on protected routes, 5-per-15-min login rate limit
- CRUD, PATCH that changes only the fields you send, issue filters, visit history for the visit cards

Other checks:

```bash
npm run typecheck   # shared, server, client (vue-tsc)
npm run build       # shared → server → client PWA (client/dist/pwa)
```

## How sync works (server side)

Everything entered on a pool screen becomes one **package**:

```jsonc
{
  "packageId": "uuid-v7",          // idempotency key
  "poolId": "uuid-v7",
  "createdAt": "2026-10-31T15:00:00Z",
  "visit":   { ... },              // optional, full document with client _id / createdAt / updatedAt
  "issues":  [ ... ],
  "notes":   [ ... ],
  "photos":  [ ... ],              // metadata; image bytes are multipart files named by photo _id
  "weekToggle": { "done": true, "at": "..." }
}
```

`POST /api/sync/package` accepts JSON, or `multipart/form-data` with a `package` field plus one file per photo. The server:

1. Checks the `syncLog` collection. If the `packageId` is already there, it returns 200 with `duplicate: true` and changes nothing.
2. Otherwise, in **one MongoDB transaction**, it upserts each document with last-write-wins on `updatedAt`, applies the weekly checkmark, and writes the `syncLog` entry.
3. If two copies of the same package race, the duplicate-key error on `syncLog` is caught and reported as a duplicate.
4. Errors come back as 4xx (bad package, unknown pool or chemical, missing photo file), so the phone can mark the package `failed`. Retrying on a network error is always safe.

`GET /api/sync/pull?since=<serverTime>` returns every document written since then, soft-deleted ones included. Filtering uses a server-side `syncedAt` timestamp, not the phone's clock, with a 5-second overlap. The first pull (no `since`) returns only what the phone keeps locally: all live customers, pools, chemicals, notes and photos, the last 2 visits per pool, and open issues plus those resolved in the last 30 days.

Every document has a client-generated UUID `_id`, plus `createdAt`, `updatedAt` and `deletedAt` (soft delete).

## API

All routes are under `/api` and need the session cookie, except `/auth/login` and `/health`. Request bodies are validated with the shared Zod schemas.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/login` | `{password, remember}`: sets the HttpOnly cookie (90 days with `remember`). Rate-limited to 5 per 15 min per IP |
| POST | `/auth/logout` | Ends the session |
| GET | `/auth/me` | 200 if logged in |
| GET | `/health` | Liveness (`{ok, mongo}`) |
| GET | `/sync/pull?since=` | Changes since a server timestamp |
| POST | `/sync/package` | Apply one field package (idempotent on `packageId`) |
| GET/POST/PATCH/DELETE | `/customers`, `/pools`, `/chemicals`, `/notes`, `/issues` | CRUD for online edits; DELETE is a soft delete; `?includeDeleted=true` |
| GET | `/pools?serviceDay=&customerId=&active=` | Pool list filters |
| GET | `/issues?status=open,in_progress&poolId=` | Issue lists (statuses: `open`, `in_progress`, `postponed`, `resolved`) |
| GET | `/pools/:id/visits?limit=` | Latest visits, newest first. The default of 2 covers the current and previous visit cards; Pool overview uses 10 |
| POST | `/route/reset-week` | Clears every pool's weekly checkmark |
| GET | `/photos/:id`, `/photos/:id/thumb` | Image (thumbnail falls back to the original until Phase 5) |

## Changes from the original outline

- The visit screen shows **cards** instead of "previous value above each input". The current card holds readings and doses, and the previous visit's card (readings and doses, read-only) sits below it. On the server side, `GET /pools/:id/visits` defaults to 2 visits, and the shared `READINGS` constant has ideal and acceptable ranges for highlighting.
- Issues gained a **`postponed`** status alongside `open`, `in_progress` and `resolved`. "Completed" in the UI is `resolved`. The shared `applyIssueStatus()` stamps `resolvedAt` / `postponedAt`, and the phone and server both use it.
- `pools.week` has a `changedAt` timestamp. An offline checkmark made *before* a Reset week, but synced after it, doesn't re-check the pool.
- Every document has a server-side `syncedAt` so pulls don't depend on the phone's clock.

## Production (preview; finished in Phase 6)

```bash
mkdir -p data/photos && sudo chown 1000:1000 data/photos   # the api container runs as the "node" user
docker compose up -d --build
```

The `api` image builds the PWA and serves it from `/`, with an SPA fallback. In production, remove the `ports:` mapping on `mongo`, and enable the `cloudflared` service in `docker-compose.yml` with your tunnel token.
