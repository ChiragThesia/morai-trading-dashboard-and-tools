import os

# `morai.settings` instantiates a module-level `Settings()` singleton at import time
# (D-15 — boot fails loudly, not on first request). That means `DATABASE_URL` must be
# present *before* pytest collects any test module that imports `morai.settings`,
# since monkeypatch fixtures only run inside a test, after collection already happened.
# This placeholder never touches a database — individual tests override it with their
# own monkeypatch.setenv/delenv and construct their own `Settings()` instances.
os.environ.setdefault(
    "DATABASE_URL", "postgresql://placeholder:placeholder@localhost:5432/placeholder"
)
