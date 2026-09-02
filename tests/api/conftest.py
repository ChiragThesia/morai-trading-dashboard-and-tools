"""Shared fixtures for the API route test suite (Phase 9, `tests/api/` --
new as of this plan).

Reuses `logged_in_client`, `provisioned_users`, `app_db_session`,
`superuser_db_session`, `SeededUsers`, `clean_reconciliation_tables` and
every fixture that chain transitively depends on, all from
`tests/ingest/conftest.py` -- which already aggregates
`tests/vendor/conftest.py`'s and `tests/identity/conftest.py`'s own
fixtures for exactly this reason. Importing the fixture functions directly
rather than `pytest_plugins`, for the identical double-registration reason
those modules' own docstrings explain: pytest resolves a fixture by name
lookup in the *requesting* module's own namespace, so every name in the
dependency chain -- not only the ones a test in this directory calls by
name -- must be importable here too.
"""

from __future__ import annotations

from tests.ingest.conftest import (
    SeededUsers,
    app_db_session,
    clean_connection_tables,
    clean_identity_tables,
    clean_ingest_tables,
    clean_ledger_tables,
    clean_reconciliation_tables,
    logged_in_client,
    provisioned_users,
    seeded_position,
    seeded_users,
    superuser_db_session,
)

# Re-exported, not merely imported -- see this module's own docstring and
# `tests/ingest/conftest.py`'s identical convention.
__all__ = [
    "SeededUsers",
    "app_db_session",
    "clean_connection_tables",
    "clean_identity_tables",
    "clean_ingest_tables",
    "clean_ledger_tables",
    "clean_reconciliation_tables",
    "logged_in_client",
    "provisioned_users",
    "seeded_position",
    "seeded_users",
    "superuser_db_session",
]
