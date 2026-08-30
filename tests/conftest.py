from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

import pytest

# `morai.settings` instantiates a module-level `Settings` singleton at import time
# (D-15 — boot fails loudly, not on first request). That means `DATABASE_URL` must be
# present *before* pytest collects any test module that imports `morai.settings`,
# since monkeypatch fixtures only run inside a test, after collection already happened.
# This placeholder never touches a database — individual tests override it with their
# own monkeypatch.setenv/delenv and construct their own `Settings` instances.
os.environ.setdefault(
    "DATABASE_URL", "postgresql://placeholder:placeholder@localhost:5432/placeholder"
)


@pytest.fixture(autouse=True)
def isolate_from_ambient_dotenv(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[None]:
    """Run every test in an empty directory, so no test ever reads the developer's
    real `.env`.

    `Settings` is configured with `env_file=".env"`, which pydantic-settings resolves
    relative to the *current working directory*. A suite run from the repository root
    therefore loads whatever that developer happens to have in `.env` — here, a v1-era
    file carrying live Schwab credentials that this backend does not declare. Under
    `extra="forbid"` those keys fail validation, so the result of the suite depends on
    a file that is deliberately untracked and differs on every machine.

    That is how this suite reported green when it was first written: it ran inside a
    git worktree, which had no `.env` because the file is gitignored and so never
    propagated. The same commit failed the moment it ran from the primary checkout.
    A test whose outcome turns on an untracked file is not a test.

    Tests that *want* an env file write their own into `tmp_path` — they are already
    running inside it, so they need no chdir of their own.
    """
    monkeypatch.chdir(tmp_path)
    yield
