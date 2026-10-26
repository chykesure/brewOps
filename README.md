# BrewOps — Digital Work Order & PM System

A mobile-first PWA that digitizes plant maintenance for a brewing operation: machine status registry, work orders, preventive maintenance (PM) plans, escalations, daily reports and an owner-only Developer Console — designed around how an Engineer (plant lead) and Artisans (line technicians) actually work on the floor.

---

## What's inside

| Area | What it does |
|------|-------------|
| **Status Registry** | 12 machines / 48 components across Brewhouse, Cellars, CIP Plant & Utilities; 10-line statuses (Working, Standby, Simulation, Bypass, Faulty, Maintenance, Awaiting Spares, Broken, LOTO, Commissioning); every flip auto-opens/closes downtime |
| **Work Orders** | Corrective + PM-linked WOs with accept → start → step-wise execution → evidence photo → sign-off, reassignment, extension, cancellation; QR-machine tagging and GPS-verified check-ins |
| **PM System** | PM plan builder + templates, scheduler tick that spawns WOs on due dates, PM history per machine |
| **Escalations** | Raise-a-hand from any artisan screen, reroute/dispatch from the engineer's Command Center |
| **Reports** | Daily report document, status-log & WO print documents (print-optimized CSS), CSV + XLSX exports |
| **Security** | PIN login + HMAC cookie sessions, trusted-device pairing (strong password needed for new devices), 10-min idle auto-logout, per-user license keys (artisan access can be granted/revoked), maintenance lockout screen |
| **PWA** | Installable — an **Install as app** button sits on both dashboards (desktop sidebar + mobile top bar); fires the native browser install prompt, guides iPhone users through Share → Add to Home Screen, and hides itself once installed |
| **Developer Console** | Owner-only 5-tab console: Overview (counters, maintenance master switch, login-screen quick sign-in switch), Trends, Access (licenses, live sessions, trusted devices, plant-wide sign-out), Data (backups + one-click restore points), Audit (permanent operation trail) |

## Tech stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS 4** + **shadcn/ui** components
- **Prisma 6** + **SQLite** (file-based — zero external services)
- **Bun** runtime (Node 20+ works too — see note below)

## Quick start

```bash
# 1 — install dependencies
bun install        # get Bun at https://bun.sh

# 2 — generate the Prisma client
bun run db:generate

# 3 — run it
bun run dev
```

Open **http://localhost:3000**. That's it.

> **The database ships included.** `db/custom.db` contains the full working plant (users, machines, components, status history, work orders, PM plans) so the app is alive on first launch. If the `db/` folder were ever empty, run `bun run db:push` once to recreate the schema.

> **Using Node instead of Bun?** Node 20+ works: `npm install`, `npx prisma generate`, `npm run dev`. The bundled `bun.lock` is for Bun; npm will resolve versions from `package.json`.

## Default logins

All seeded accounts use **PIN `1234`** (password equals the PIN until changed in Profile → Security):

| Role | Email | Trade / Shift |
|------|-------|---------------|
| **Engineer** (admin) | `engineer@brewops.ng` | — / Shift A |
| Artisan | `yusuf@brewops.ng` | Mechanical / A |
| Artisan | `bello@brewops.ng` | Mechanical / A |
| Artisan | `okafor@brewops.ng` | Electrical / B |
| Artisan | `eze@brewops.ng` | Electrical / B |
| Artisan | `adeyemi@brewops.ng` | — |

Log in with **email + PIN**. If the *Quick sign-in (pilot devices)* chip is enabled, it offers one-tap access for previously trusted devices — the engineer can hide/show this chip from the Developer Console (see below).

## Developer Console (owner only)

Open it with **Shift+Alt+B** (or **Ctrl+Alt+B**), or append **`/#dev`** to the URL, then enter the owner PIN — default **`1004`**.

| Tab | Capabilities |
|-----|--------------|
| **Overview** | Live plant counters, **maintenance master switch** (locks every artisan behind a branded maintenance screen while the engineer keeps working), **Quick sign-in switch** (hides the pilot login chip → email + PIN only door) |
| **Trends** | Usage charts: status logs, WOs created vs completed, downtime per day, 7/14/30-day windows |
| **Access** | License overview + license desk, live sessions (kick one / all), trusted devices (revoke), plant-wide sign-out |
| **Data** | Download backups, capture **one-click restore points**, roll the database back, resets |
| **Audit** | Permanent operation trail with action filters |

## Environment variables (`.env`)

```ini
DATABASE_URL=file:../db/custom.db   # relative to prisma/schema.prisma — works out of the box
# Optional, recommended in production:
# SESSION_SECRET=<long random string>   # cookie signing key (has a built-in default)
# DEV_PIN=<your pin>                    # developer console owner PIN (default 1004)
```

## Resetting to fresh demo data

```bash
bun prisma/seed.ts
```

This **wipes everything** and re-seeds the full demo scenario from the original pitch deck: 12 machines / 48 components, parts inventory (incl. a below-reorder part), 3 days of status history, and work orders mirroring real brewery cases (Lauter Rake PM in progress, Whirlpool seal check overdue, urgent CIP corrective…).

## Production build

```bash
bun run build   # standalone output in .next/standalone
bun run start   # serves it (defaults to port 3000)
```

## Deploying to the internet

See **[DEPLOY.md](./DEPLOY.md)** — a step-by-step PaaS guide (Railway recommended, Render and Fly.io as alternatives) using the included `Dockerfile` + `docker-entrypoint.sh`. The container keeps all state on a persistent volume at `/data` (database, restore points, photo evidence), auto-seeded on first boot.

General deployment notes:
- SQLite is single-node — host the app (and the `db/` folder) on one machine, or mount `db/` and `public/uploads/` as persistent volumes.
- Set `SESSION_SECRET` and `DEV_PIN` in production; the app sends hardened security headers (CSP, X-Frame-Options DENY, Permissions-Policy) already.
- HTTPS matters for the PWA install prompt and camera/GPS permissions — serve behind TLS in production.

## Project structure

```
src/
  app/                    # App Router pages + API routes
    api/                  # auth, bootstrap, status, workorders, machines, parts,
                          # escalations, reports/exports, devices, upload, dev-console APIs
  components/
    brewops/              # the application: login, dashboards, views/, dev console
    ui/                   # shadcn/ui primitives
  lib/                    # session, db, scheduler, license, security, PWA install…
prisma/
  schema.prisma           # data model (SQLite-safe string enums)
  seed.ts                 # full demo plant seeder
db/
  custom.db               # ready-to-run SQLite database (ships with data)
  backups/                # restore points captured from the Dev Console
public/
  icon.svg                # app icon (favicon + PWA)
  manifest.webmanifest    # PWA manifest
  uploads/                # evidence photos uploaded in-app
Dockerfile                # production container (Bun build → Node runtime, /data volume)
docker-entrypoint.sh      # first-boot seeding + schema sync + server start
```

## Where things live (cheat sheet)

- **Install as app button** → `src/components/brewops/install-app-button.tsx` + `src/lib/pwa-install.ts` (mounted in the shared dashboard chrome in `src/components/brewops/app-controller.tsx`)
- **Quick sign-in switch** → Dev Console Overview card, backed by `/api/dev/quick-signin` and read by the login door via `/api/login-opts` (`src/components/brewops/login-view.tsx`)
- **Photo evidence upload** → `/api/upload` (`src/app/api/upload/route.ts`) stores under `public/uploads`
- **Maintenance lockout** → `src/components/brewops/maintenance-screen.tsx`
- **Idle auto-logout** → `src/components/brewops/idle-logout.tsx`
- **License system** → `src/lib/license.ts`
