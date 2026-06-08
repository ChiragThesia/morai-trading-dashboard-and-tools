# Dockerfile fallback for apps/server (D-03).
# Nixpacks is the default builder (railway.json forces NIXPACKS).
# Use this only if Nixpacks monorepo Bun detection proves flaky:
#   Railway → service → Settings → RAILWAY_DOCKERFILE_PATH=/apps/server/Dockerfile
#
# Build context must be the repo root (Railway default when no root directory is set).

FROM oven/bun:1.3 AS base
WORKDIR /app

# Copy lockfile + root manifest (workspace declaration) first for layer caching
COPY package.json bun.lock ./

# Copy all packages and the server app
COPY packages/ packages/
COPY apps/server/ apps/server/

# Install with the frozen lockfile (audited in CI)
RUN bun install --frozen-lockfile

# PORT is injected by Railway at runtime
ENV PORT=3000

CMD ["bun", "run", "apps/server/src/main.ts"]
