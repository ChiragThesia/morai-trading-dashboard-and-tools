# Dockerfile for apps/worker — PRIMARY Railway builder for this service.
# Per-service start commands can't be set on Railway CLI 4.11, and Nixpacks Bun
# monorepo detection is flaky, so each service builds from its own Dockerfile,
# selected per-service via the RAILWAY_DOCKERFILE_PATH env var (=apps/worker/Dockerfile).
# Build context is the repo root (Railway default when no root directory is set).

FROM oven/bun:1.3 AS base
WORKDIR /app

# Copy lockfile + root manifest (workspace declaration) first for layer caching
COPY package.json bun.lock ./

# Copy ALL workspace members — `bun install --frozen-lockfile` validates every
# package the root workspace globs reference; a missing member fails the install.
COPY packages/ packages/
COPY apps/ apps/

# Install with the frozen lockfile (audited in CI)
RUN bun install --frozen-lockfile

# TZ is required by worker for pg-boss cron alignment; set via Railway env var
ENV TZ=America/New_York

CMD ["bun", "run", "apps/worker/src/main.ts"]
