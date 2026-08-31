"""Deliberate negative control (D3-13). Do not fix.

Constructing a `Fill` directly, with the real column keywords but no
`_write_token`, must fail type-check before the process runs -- the
natural bypass of the single write path into the fill table (D3-13,
D3-15): a developer who already has the plaintext values reaches for
`Fill(...)` directly instead of going through `insert_fills()`, which is
the only place encryption happens. Every other argument is annotated
correctly (real column keywords, matching types) so the only diagnostic
either checker reports is the missing-argument violation on
`_write_token`, not a second, unrelated one. Excluded from the real gate's
own run (see `pyproject.toml`).
"""

from datetime import UTC, datetime
from uuid import uuid4

from morai.db.models import Fill


def _build() -> Fill:
    return Fill(
        user_id=uuid4(),
        order_id="1006681717677",
        occ_symbol="SPXW260618P07275000",
        leg_index=0,
        execution_time=datetime(2026, 6, 18, 14, 30, tzinfo=UTC),
        position_effect="OPEN",
        side="BUY",
        quantity_ciphertext=None,
        quantity_nonce=None,
        price_usd_ciphertext=None,
        price_usd_nonce=None,
        key_version=1,
    )
