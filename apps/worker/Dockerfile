# Dockerfile fallback for apps/worker (D-03).
# Nixpacks is the default builder (railway.json forces NIXPACKS).
# Use this only if Nixpacks monorepo Bun detection proves flaky:
#   Railway → service → Settings → RAILWAY_DOCKERFILE_PATH=/apps/worker/Dockerfile
#
# Build context must be the repo root (Railway default when no root directory is set).

FROM oven/bun:1.3 AS base
WORKDIR /app

# Copy lockfile + root manifest (workspace declaration) first for layer caching
COPY package.json bun.lock ./

# Copy all packages and the worker app
COPY packages/ packages/
COPY apps/worker/ apps/worker/

# Install with the frozen lockfile (audited in CI)
RUN bun install --frozen-lockfile

# TZ is required by worker for pg-boss cron alignment; set via Railway env var
ENV TZ=America/New_York

CMD ["bun", "run", "apps/worker/src/main.ts"]
