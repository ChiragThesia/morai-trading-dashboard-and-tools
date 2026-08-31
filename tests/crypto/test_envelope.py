"""The envelope's negative cases: tamper, wrong key, wrong nonce, wrong row
(D3-01, D3-03, D3-05). Pure `bytes` in, `bytes` out -- no database, no `db`
marker, runs in milliseconds.

`03-RESEARCH.md` Pitfall 4: the wrong-row case is the one that matters most
and is easiest to write vacuously. `test_wrong_row_associated_data_raises`
builds both associated-data values through the same private helper the
write path uses (`morai.ledger.fills._fill_associated_data`), from two
fills differing in exactly one composite-key component, so the test proves
the row-binding rather than proving two arbitrary byte strings differ.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from cryptography.exceptions import InvalidTag

from morai.crypto.envelope import (
    decrypt_field,
    encrypt_field,
    generate_dek,
    unwrap_dek,
    wrap_dek,
)
from morai.db.models import Fill
from morai.ledger.fills import (
    _fill_associated_data,  # pyright: ignore[reportPrivateUsage]  # why: this test is the runtime companion proving the write path's own row-binding helper -- same cross-module private-import convention tests/test_isolation.py already uses for _seed_session.
)

_AAD = b"table:column:row-identity"

_EXECUTION_TIME = datetime(2026, 6, 18, 14, 30, tzinfo=UTC)


@pytest.mark.parametrize(
    "plaintext",
    [b"", b"159.41", b"x" * 8192],
    ids=["empty", "short", "multi-kilobyte"],
)
def test_round_trip_returns_original_plaintext(plaintext: bytes) -> None:
    dek = generate_dek()
    ciphertext, nonce = encrypt_field(plaintext, dek, _AAD)
    assert decrypt_field(ciphertext, nonce, dek, _AAD) == plaintext


def test_tampered_ciphertext_raises_invalid_tag() -> None:
    dek = generate_dek()
    ciphertext, nonce = encrypt_field(b"159.41", dek, _AAD)
    tampered = bytes([ciphertext[0] ^ 0x01]) + ciphertext[1:]
    with pytest.raises(InvalidTag):
        decrypt_field(tampered, nonce, dek, _AAD)


def test_wrong_key_raises_invalid_tag() -> None:
    dek = generate_dek()
    other_dek = generate_dek()
    ciphertext, nonce = encrypt_field(b"159.41", dek, _AAD)
    with pytest.raises(InvalidTag):
        decrypt_field(ciphertext, nonce, other_dek, _AAD)


def test_wrong_nonce_raises_invalid_tag() -> None:
    dek = generate_dek()
    ciphertext, nonce = encrypt_field(b"159.41", dek, _AAD)
    _, other_nonce = encrypt_field(b"unrelated", dek, _AAD)
    assert other_nonce != nonce
    with pytest.raises(InvalidTag):
        decrypt_field(ciphertext, other_nonce, dek, _AAD)


def test_wrong_row_associated_data_raises_invalid_tag() -> None:
    """The two AAD values differ in exactly one composite-key component
    (`leg_index`), through the same helper `insert_fills`/`read_fills` use
    -- proving the row-binding, not merely that two byte strings differ."""
    dek = generate_dek()
    user_id = uuid4()
    row_a_aad = _fill_associated_data(
        "price_usd",
        user_id=user_id,
        order_id="1006681717677",
        occ_symbol="SPXW260618P07275000",
        leg_index=0,
        execution_time=_EXECUTION_TIME,
    )
    row_b_aad = _fill_associated_data(
        "price_usd",
        user_id=user_id,
        order_id="1006681717677",
        occ_symbol="SPXW260618P07275000",
        leg_index=1,
        execution_time=_EXECUTION_TIME,
    )
    assert row_a_aad != row_b_aad

    ciphertext, nonce = encrypt_field(b"159.41", dek, row_a_aad)
    with pytest.raises(InvalidTag):
        decrypt_field(ciphertext, nonce, dek, row_b_aad)


def test_wrap_unwrap_round_trips_dek_exactly() -> None:
    dek = generate_dek()
    kek = generate_dek()
    wrapped, nonce = wrap_dek(dek, kek)
    assert unwrap_dek(wrapped, nonce, kek) == dek


def test_unwrap_under_wrong_kek_raises_invalid_tag() -> None:
    dek = generate_dek()
    kek = generate_dek()
    other_kek = generate_dek()
    wrapped, nonce = wrap_dek(dek, kek)
    with pytest.raises(InvalidTag):
        unwrap_dek(wrapped, nonce, other_kek)


def test_repeated_encryption_produces_distinct_nonces_and_ciphertexts() -> None:
    dek = generate_dek()
    results = [encrypt_field(b"159.41", dek, _AAD) for _ in range(100)]
    nonces = {nonce for _, nonce in results}
    ciphertexts = {ciphertext for ciphertext, _ in results}
    assert len(nonces) == 100
    assert len(ciphertexts) == 100


def test_constructing_fill_directly_with_wrong_token_raises_runtime_error() -> None:
    """The runtime companion to Task 3's compile-time proof (D3-13). A
    caller who supplies anything but `insert_fills()`'s own sentinel --
    including `None` -- gets `RuntimeError`, not a type error; type
    checkers verify shapes, not provenance (`identity/audit.py`'s own
    documented split)."""
    with pytest.raises(RuntimeError, match="insert_fills"):
        Fill(
            _write_token=None,
            user_id=None,
            order_id="1",
            occ_symbol="SPXW260618P07275000",
            leg_index=0,
            execution_time=_EXECUTION_TIME,
            position_effect="OPEN",
            side="BUY",
            quantity_ciphertext=None,
            quantity_nonce=None,
            price_usd_ciphertext=None,
            price_usd_nonce=None,
            key_version=1,
        )
