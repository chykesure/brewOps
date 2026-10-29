#!/bin/sh
# BrewOps container entrypoint
# 1. Seeds the persistent volume with the bundled database on first boot
# 2. Points the app's writable dirs (db/, public/uploads) at the volume
# 3. Applies the Prisma schema (idempotent)
# 4. Starts the Next.js standalone server
set -e

DATA_DIR="${DATA_DIR:-/data}"
PORT="${PORT:-3000}"
APP_DIR="$(cd "$(dirname "$0")" && pwd)"   # container: /app
cd "${APP_DIR}"

echo ">> BrewOps entrypoint — data dir: ${DATA_DIR}"

# ---- 1. first-boot seeding -------------------------------------------------
if [ ! -f "${DATA_DIR}/db/custom.db" ]; then
  echo ">> First boot: seeding database volume from the bundled snapshot..."
  mkdir -p "${DATA_DIR}/db"
  cp "${APP_DIR}/seed-db/custom.db" "${DATA_DIR}/db/custom.db"
fi

# Bundled Dev Console restore points (only when the volume has none yet)
if [ -d "${APP_DIR}/seed-db/backups" ] && [ -z "$(ls -A "${DATA_DIR}/db/backups" 2>/dev/null)" ]; then
  mkdir -p "${DATA_DIR}/db/backups"
  cp -a "${APP_DIR}/seed-db/backups/." "${DATA_DIR}/db/backups/"
fi

# Bundled photo evidence (only when the volume has none yet)
if [ -z "$(ls -A "${DATA_DIR}/uploads" 2>/dev/null)" ]; then
  cp -a "${APP_DIR}/seed-uploads/." "${DATA_DIR}/uploads/"
fi

# ---- 2. writable dirs → volume ---------------------------------------------
mkdir -p "${DATA_DIR}/uploads"
# db/ (database + Dev Console restore points under db/backups)
rm -rf ./db
ln -s "${DATA_DIR}/db" ./db
# photo evidence
rm -rf ./public/uploads
ln -s "${DATA_DIR}/uploads" ./public/uploads

# ---- 3. schema sync ---------------------------------------------------------
export DATABASE_URL="${DATABASE_URL:-file:${DATA_DIR}/db/custom.db}"
echo ">> Syncing database schema (prisma db push)..."
prisma db push --skip-generate

# ---- 4. run ------------------------------------------------------------------
echo ">> Starting BrewOps on port ${PORT}..."
exec node server.js
