# Deploying BrewOps to the internet (PaaS guide)

BrewOps ships as a **self-contained single-server app** (Next.js + SQLite). The included
`Dockerfile` packages it so any container platform can run it unchanged. The one rule:
**the SQLite database and photo uploads must live on a persistent volume** (`/data`).

## What's included for deployment

| File | Purpose |
|------|---------|
| `Dockerfile` | Two-stage build: Bun compiles the Next.js standalone bundle, slim Node serves it |
| `docker-entrypoint.sh` | First-boot seeding of the volume, `db/` + `public/uploads` → volume symlinks, `prisma db push`, start server |
| `.dockerignore` | Keeps the image clean (no sandbox/QA artifacts) |

Volume layout on the host platform:

```
/data
├── db/custom.db      ← the live database (auto-seeded on first boot)
├── db/backups/       ← Dev Console restore points
└── uploads/          ← photo evidence (symlinked to public/uploads)
```

## Recommended: Railway (fully web-UI, no terminal)

1. Create a free account at [github.com](https://github.com) and upload this project to a
   **private repository** (drag-and-drop the unzipped folder on github.com's "upload files"
   page, or use GitHub Desktop).
2. Sign in at [railway.app](https://railway.app) **with GitHub** (Hobby plan: $5/mo, includes
   $5 of usage — a small app like this typically costs a few dollars).
3. **New Project → Deploy from GitHub repo** → pick your repo. Railway detects the
   `Dockerfile` and starts building (first build takes ~5–10 minutes).
4. When the service bubble appears: right-click the canvas → **Volume** → attach it to the
   service → mount path **`/data`**. Restart the service once after attaching.
5. Open the service → **Variables** tab and add:
   - `SESSION_SECRET` = any long random string (e.g. 40+ characters)
   - `DEV_PIN` = your developer-console PIN (default is `1004` if unset)
   - (optional) `DATABASE_URL` = `file:/data/db/custom.db` — the entrypoint already defaults to this
6. **Settings → Networking → Generate Domain** → you get a live HTTPS URL, e.g.
   `brewops-production.up.railway.app`. Open it → log in with the seeded accounts
   (see README) → the full plant data is already there.
7. **Custom domain** (optional): in Railway **Settings → Domains → Custom Domain**, then add
   the CNAME record it shows at your domain registrar (e.g. `app.brewops.ng`). HTTPS is
   issued automatically.

Deployments are automatic afterwards: every `git push` redeploys; the volume keeps data.

## Backups after go-live

Weekly habit: **Developer Console → Data → download** a restore point (one JSON file).
Keep it somewhere safe. Rolling back is one click in the same tab.

## Alternative: Render

Same Dockerfile. Create a **Web Service** from the repo, add a **Persistent Disk** mounted
at `/data` (requires a paid instance, ~$7/mo), set the same variables, deploy.

## Alternative: Fly.io

```bash
fly launch                 # detects the Dockerfile; choose "no additional databases"
fly volumes create brewops_data --size 1 --region ams
fly deploy
```
Set `SESSION_SECRET` / `DEV_PIN` with `fly secrets set ...`.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Build fails | Open the deploy log; check the failed step name and send it for review |
| "Application failed to respond" | Make sure the volume is mounted at **`/data`**, then redeploy |
| Empty plant after deploy | Volume missing or mounted at the wrong path — the entrypoint seeds `/data` only |
| Forgot DEV_PIN | Change the `DEV_PIN` variable and redeploy |
| Photos disappear after redeploy | Volume not mounted at `/data` (uploads live on the volume) |
