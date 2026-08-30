#!/usr/bin/env bash
# The single gate script. CI and any local hook both call this, so they cannot drift
# apart (D-05, D-06, OPS-01).
#
# NOTE: the bare `uv run pytest` below includes `db`-marked tests and therefore only
# passes where a Postgres is reachable — CI (plan 01-02). Locally, where Docker is
# broken and no database is reachable (see 01-01-PLAN.md), run:
#   uv run pytest -m "not db"
set -euo pipefail

uv run ruff check src tests
uv run ruff format --check src tests
uv run basedpyright
uv run mypy src tests
uv run pytest
