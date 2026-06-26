FROM python:3.11-slim
WORKDIR /app

# Build context is the repo root (railway.sidecar.toml sets dockerfilePath =
# apps/sidecar/Dockerfile with no rootDirectory), so COPY paths are root-relative.
COPY apps/sidecar/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/sidecar/ .

# Bind to :: (all interfaces, IPv4+IPv6) for Railway private networking.
# MUST NOT use 0.0.0.0 (IPv4-only) — Railway private net uses IPv6 in legacy
# environments; binding 0.0.0.0 causes ECONNREFUSED from apps/server (RESEARCH Pitfall 5).
# PORT is set by Railway at deploy time.
CMD ["sh", "-c", "uvicorn main:app --host :: --port ${PORT:-8000}"]
