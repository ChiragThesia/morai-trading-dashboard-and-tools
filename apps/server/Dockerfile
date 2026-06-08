# Dockerfile for apps/server — PRIMARY Railway builder for this service.
# Per-service start commands can't be set on Railway CLI 4.11, and Nixpacks Bun
# monorepo detection is flaky, so each service builds from its own Dockerfile,
# selected per-service via the RAILWAY_DOCKERFILE_PATH env var (=apps/server/Dockerfile).
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

# PORT is injected by Railway at runtime
ENV PORT=3000

CMD ["bun", "run", "apps/server/src/main.ts"]
