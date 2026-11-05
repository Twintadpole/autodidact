# Deploying to the VPS

The app runs with Docker Compose on the VPS, as the `claude` user, in `~/autodidact/pool-service`. Cloudflare Tunnel (`cloudflared` running on the host, managed from the Cloudflare dashboard) forwards **https://poolapp.evolutiondfw.com** to `http://localhost:3000`. The API listens only on `127.0.0.1:3000`, and MongoDB only on `127.0.0.1:27017`.

| Script | When | What it does |
| --- | --- | --- |
| `bootstrap-claude-user.sh` | Once, as root, on a fresh VPS | Creates the `claude` user (sudo), sets up the firewall and swap, installs Claude Code, clones the repo |
| `install-docker.sh` | Once: `sudo bash deploy/install-docker.sh` | Docker Engine and the compose plugin (Docker's repo, or Ubuntu's packages as a fallback); adds `claude` to the docker group |
| `first-deploy.sh` | Once: `bash deploy/first-deploy.sh` | Builds the image, writes `.env` with a fresh session secret and a random app password (printed once and saved to `~/pool-app-initial-password.txt`), starts the stack, installs the nightly backup |
| `update.sh` | After each new version | `git pull` and rebuild/restart; data and `.env` are kept |
| `set-password.sh` | Any time | Changes the app password (prompts twice; or `echo 'pw' \| bash deploy/set-password.sh -`) |
| `backup.sh` | Nightly at 03:17 (cron), or by hand | `mongodump` to `backups/pool-<time>.archive.gz`, keeps the newest 14, writes `backups/LAST_BACKUP` |

Useful commands, run from `~/autodidact/pool-service`:

```bash
docker compose ps
docker compose logs -f api
curl -s http://127.0.0.1:3000/api/health
```

**End-to-end check (phone-size browser, against the live site):** creates and then deletes its own "E2E test" customer.

```bash
PW=<app password>
sudo docker run --rm --network host -v "$PWD/e2e:/e2e" -w /e2e mcr.microsoft.com/playwright:v1.56.1-noble \
  bash -c "npm i -s playwright@1.56.1 >/dev/null && node phase3.cjs https://poolapp.evolutiondfw.com/ \"$PW\" /e2e/out"
```

**Restore a backup:**

```bash
docker compose exec -T mongo mongorestore --drop --archive --gzip < backups/pool-<time>.archive.gz
```

Photos (`data/photos`) aren't in these dumps yet. Phase 6 adds photos and offsite copies.
