FROM python:3.11-slim
WORKDIR /app

# Build context is the repo root (railway.sidecar.toml sets dockerfilePath =
# apps/sidecar/Dockerfile with no rootDirectory), so COPY paths are root-relative.
COPY apps/sidecar/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/sidecar/ .

# Hypercorn dual-stack binds on [::] — IPv6 (Railway private networking, RESEARCH
# Pitfall 5) AND IPv4 (the Railway deploy healthcheck probes IPv4 loopback). uvicorn
# cannot dual-stack from the CLI, so it passes private net but fails the healthcheck.
# MUST NOT use 0.0.0.0 (IPv4-only) — private net needs IPv6. PORT set by Railway at deploy.
CMD ["sh", "-c", "hypercorn main:app --bind [::]:${PORT:-8000}"]
