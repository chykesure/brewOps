# ============================================================================
# BrewOps — Digital Work Order & PM System
# Multi-stage image: Bun builds the Next.js standalone bundle,
# a slim Node runtime serves it with a persistent volume at /data.
#
# Golden rule: /data is the ONLY state that survives redeploys.
#   /data/db/custom.db    → SQLite database (seeded on first boot)
#   /data/db/backups/     → Dev Console restore points
#   /data/uploads/        → photo evidence (symlinked into public/uploads)
# ============================================================================

# ---------- Stage 1: build ----------
FROM oven/bun:1 AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Placeholder so module loading never fails during the build itself
ENV DATABASE_URL="file:/tmp/build-placeholder.db"

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bunx prisma generate
RUN bun run build

# ---------- Stage 2: runtime ----------
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/data

# openssl + CA certs for the Prisma engines; Prisma CLI (global) for schema sync
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g --no-audit --no-fund prisma@6.19.2

# Next.js standalone server (server.js + pruned node_modules + static + public)
COPY --from=builder /app/.next/standalone ./
# Prisma schema (the CLI is installed globally; the client ships inside standalone)
COPY --from=builder /app/prisma ./prisma
# Bundled database + restore point → seeds the volume on first boot
COPY --from=builder /app/db/custom.db ./seed-db/custom.db
COPY --from=builder /app/db/backups ./seed-db/backups
COPY --from=builder /app/public/uploads ./seed-uploads/
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x ./docker-entrypoint.sh \
 && mkdir -p /data
# /data is provided by the platform's volume mount (Railway/Render/Fly)

EXPOSE 3000
ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]
