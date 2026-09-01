"""Deliberate negative control (D6-02). Do not fix.

Constructing a `BrokerTransaction` directly, with the real column keywords
but no `_write_token`, must fail type-check before the process runs -- the
natural bypass this fixture models: a developer who already holds a
validated vendor payload reaches for `BrokerTransaction(...)` directly
instead of going through `insert_broker_transactions()`, the one function
that encrypts and chunks. Every other argument is annotated correctly (real
column keywords, matching types) so the only diagnostic either checker
reports is the missing-argument violation on `_write_token`, not a second,
unrelated one. Excluded from the real gate's own run (see
`pyproject.toml`).
"""

from datetime import UTC, datetime
from uuid import uuid4

from morai.db.models import BrokerTransaction


def _build() -> BrokerTransaction:
    return BrokerTransaction(
        user_id=uuid4(),
        activity_id="1006681717677",
        transaction_type="TRADE",
        transaction_time=datetime(2026, 6, 18, 14, 30, tzinfo=UTC),
        order_id="1006681717677",
        raw_ciphertext=b"",
        raw_nonce=b"",
        key_version=1,
    )
