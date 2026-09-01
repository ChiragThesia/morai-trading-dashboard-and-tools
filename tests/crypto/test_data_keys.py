"""WR-02: `current_dek` and `dek_for_version` must agree on whether a
missing `user_data_keys` row is a domain error. Before this fix,
`dek_for_version` raised the module's own `DataKeyMissing` and `current_dek`
let `sqlalchemy.exc.NoResultFound` escape unwrapped -- this module proves
both now raise the same typed exception for the same missing-key shape.

`@pytest.mark.db` -- needs a live Postgres; `seeded_users` deliberately
provisions no `user_data_keys` row for either non-admin user.
"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from morai.crypto.data_keys import DataKeyMissing, current_dek, dek_for_version
from tests.identity.conftest import (
    SeededUsers,
    app_db_session,
    clean_identity_tables,
    seeded_users,
    superuser_db_session,
)

# Re-exported, not merely imported -- tests/crypto/ is a sibling of
# tests/identity/, not a descendant, so pytest's ancestor-conftest fixture
# discovery does not see these on its own (same convention
# test_nonce_uniqueness.py already establishes for tests/ledger/conftest.py).
__all__ = [
    "app_db_session",
    "clean_identity_tables",
    "seeded_users",
    "superuser_db_session",
]

pytestmark = pytest.mark.db


async def test_current_dek_raises_data_key_missing_for_a_shredded_account(
    app_db_session: AsyncSession, seeded_users: SeededUsers
) -> None:
    with pytest.raises(DataKeyMissing):
        await current_dek(app_db_session, seeded_users.user_a)


async def test_dek_for_version_raises_data_key_missing_for_a_shredded_account(
    app_db_session: AsyncSession, seeded_users: SeededUsers
) -> None:
    with pytest.raises(DataKeyMissing):
        await dek_for_version(app_db_session, seeded_users.user_a, 1)
