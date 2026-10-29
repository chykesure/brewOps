#!/bin/sh
# BrewOps container entrypoint
#
# Mode 1 — PostgreSQL (production): DATABASE_URL starts with postgres://
#   The database lives in the cloud (Supabase), OUTSIDE the container, so
#   Render sleeps, restarts and redeploys can never reset your data.
#   Steps: point writable dirs at /data → sync schema → start server.
#
# Mode 2 — no PostgreSQL URL configured: refuse to boot with a clear message
#   (the app no longer carries its database inside the container).
set -e

DATA_DIR="${DATA_DIR:-/data}"
PORT="${PORT:-3000}"
APP_DIR="$(cd "$(dirname "$0")" && pwd)"   # container: /app
cd "${APP_DIR}"

case "${DATABASE_URL:-}" in
  postgres*)
    echo ">> BrewOps entrypoint — PostgreSQL mode (external cloud database)"

    # Writable dirs → volume (photo evidence survives as long as the
    # container lives; the DATABASE itself survives everything)
    mkdir -p "${DATA_DIR}/uploads"
    rm -rf ./public/uploads
    ln -s "${DATA_DIR}/uploads" ./public/uploads

    echo ">> Syncing database schema (prisma db push)..."
    prisma db push --skip-generate

    echo ">> Starting BrewOps on port ${PORT}..."
    exec node server.js
    ;;

  *)
    echo "--------------------------------------------------------------" >&2
    echo "!! BrewOps now stores its data in a cloud PostgreSQL database." >&2
    echo "!! Set the DATABASE_URL environment variable to continue, e.g.:" >&2
    echo "!!   DATABASE_URL=postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres" >&2
    echo "!! (Render dashboard → your service → Environment → Add environment variable)" >&2
    echo "--------------------------------------------------------------" >&2
    exit 1
    ;;
esac