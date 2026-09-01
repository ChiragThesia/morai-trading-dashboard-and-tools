"""Criterion 1a (CRYPT-05): a real `pg_dump`, restored into a scratch
database by a process with no master key in its environment, yields no
readable price, quantity, P&L or free-text field.

03-RESEARCH.md Pitfall 1, verified live in that research session and
reproduced here as a named negative control: `pg_dump`'s plain-format dump
hex-encodes `bytea` columns, so grepping a dump for a plaintext LITERAL
returns zero matches even against a column carrying that literal completely
unencrypted -- a false pass on the phase's headline claim. The only two test
shapes that can actually fail on a leak are (1) restore into a scratch
database and read the ciphertext back through a real `AsyncEngine` pointed
at it, which decodes `bytea` to real Python `bytes` via `asyncpg`'s own
driver, not hex text, and compare raw bytes, and (2) grep the dump text for
the plaintext's HEX encoding. Both run here, as the primary and secondary
arms of one test. Neither uses the naive literal grep as anything but the
negative control proving why it is not the test --
`test_naive_literal_grep_passes_but_hex_grep_catches_unencrypted_marker`
runs entirely inside its own throwaway scratch database and never touches
the live schema.

Reads go through `sqlalchemy.ext.asyncio.create_async_engine` against the
scratch database's own DSN, not a raw `asyncpg.connect()` -- `asyncpg`
ships no type stubs of its own, and this project's own no-`Any` policy
already has a standing answer for an untyped read boundary (`TypeAdapter`
narrowing at the `text()` call site, the same pattern `morai.ledger.fills`/
`morai.ledger.events` and every raw-SQL test in this suite already uses):
reach for the boundary this codebase already has, not a second, differently
untyped one.

No dedicated free-text column exists on `fills`/`events` yet -- CRYPT-02's
"free-text entry fields" land with a real notes-shaped column in a later
phase. The free-text case here is proved with the exact primitive and
per-user DEK `insert_fills()` uses internally (`encrypt_field`,
`_current_dek`, `_fill_associated_data`), applied to a distinctive marker
string instead of a `Decimal` -- the encryption boundary is content-
agnostic, not merely `Decimal`-shaped, and this is the cheapest honest way
to prove that without adding a schema column this plan's own
`files_modified` does not name.

`@pytest.mark.db` -- needs a live Postgres and the `pg_dump`/`createdb`/
`psql`/`dropdb` client binaries, resolved from
`/opt/homebrew/opt/postgresql@18/bin` (confirmed present this session, per
this plan's own `<environment>` block), falling back to `shutil.which`.
Never a silent skip on a missing binary -- `tests/conftest.py`'s own
`migrated_db` fixture states the same reasoning: a silently skipped
confidentiality test looks like coverage and is worse than none.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import pytest
from pydantic import TypeAdapter
from sqlalchemy import text
from sqlalchemy.engine.url import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from morai.crypto.envelope import encrypt_field
from morai.ledger.events import EventWrite, insert_events
from morai.ledger.fills import (
    FillWrite,
    _current_dek,  # pyright: ignore[reportPrivateUsage]  # why: this test needs the real per-user DEK to encrypt a free-text marker with the exact primitive insert_fills() uses internally, not a second key-derivation path.
    _fill_associated_data,  # pyright: ignore[reportPrivateUsage]  # why: same cross-module private-import convention tests/crypto/test_envelope.py already uses for AAD row-binding.
    insert_fills,
)
from morai.settings import Settings, get_settings
from tests.identity.conftest import SeededUsers
from tests.ledger.conftest import (
    SeededPosition,
    app_db_session,
    clean_identity_tables,
    clean_ledger_tables,
    provisioned_users,
    seeded_position,
    seeded_users,
    superuser_db_session,
)

# Re-exported, not merely imported -- this module lives at the top level of
# `tests/`, a sibling of `tests/ledger/`, not a descendant, so pytest's
# ancestor-conftest auto-discovery does not reach `tests/ledger/conftest.py`.
# Same convention `tests/ledger/test_roll_check_constraint.py` already uses.
__all__ = [
    "app_db_session",
    "clean_identity_tables",
    "clean_ledger_tables",
    "provisioned_users",
    "seeded_position",
    "seeded_users",
    "superuser_db_session",
]

pytestmark = pytest.mark.db

REPO_ROOT = Path(__file__).resolve().parent.parent
_PG_BIN_DIR = Path("/opt/homebrew/opt/postgresql@18/bin")

_BYTES: TypeAdapter[bytes] = TypeAdapter(bytes)

_EXECUTION_TIME_1 = datetime(2026, 6, 18, 14, 30, tzinfo=UTC)
_EXECUTION_TIME_2 = datetime(2026, 6, 18, 14, 31, tzinfo=UTC)
_MARKER_EXECUTION_TIME = datetime(2026, 6, 18, 14, 32, tzinfo=UTC)
_EVENT_TIME = datetime(2026, 6, 18, 20, 0, tzinfo=UTC)

# Deliberately distinctive -- an unlikely digit sequence, so an accidental
# substring collision elsewhere in the dump (a UUID, a timestamp, a
# sequence value) cannot produce a false pass or a false fail.
_QUANTITY_1 = Decimal("77.3141")
_PRICE_USD_1 = Decimal("70417.2591")
_QUANTITY_2 = Decimal("12.9008")
_PRICE_USD_2 = Decimal("55501.4477")
_OPEN_DEBIT_USD = Decimal("8815.6623")
_CLOSE_CREDIT_USD = Decimal("2290.7734")
_FREE_TEXT_MARKER = b"MORAI_FREE_TEXT_LEAK_MARKER_9f2c7b1e"


def _resolve_pg_binary(name: str) -> str:
    """Resolve a Postgres client binary. Never a silent skip on a missing
    binary -- see module docstring."""
    candidate = _PG_BIN_DIR / name
    if candidate.exists():
        return str(candidate)
    found = shutil.which(name)
    if found is not None:
        return found
    raise RuntimeError(
        f"{name} not found at {_PG_BIN_DIR} or on PATH. Expected Postgres 18 "
        "client binaries at /opt/homebrew/opt/postgresql@18/bin (this "
        "plan's own <environment> block)."
    )


async def _run(
    argv: list[str], *, env: dict[str, str]
) -> subprocess.CompletedProcess[str]:
    """Same subprocess-invocation convention `tests/gate/test_type_gate.py`
    already established: `capture_output=True`, `text=True`, `check=False`,
    an explicit `cwd`. Routed through `asyncio.to_thread` -- this suite runs
    on one session-scoped event loop shared with every other test's own
    `AsyncEngine` (`pyproject.toml`'s own `asyncio_default_fixture_loop_scope`
    comment), and `pg_dump`/`createdb`/`psql`/`dropdb` each block for real
    wall-clock time; calling them synchronously would stall that shared loop
    for the duration, starving any other engine's own scheduled callbacks
    running on it."""
    return await asyncio.to_thread(
        subprocess.run,
        argv,
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )


async def _set_current_user(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Mirrors `tests/ledger/test_roll_check_constraint.py`'s own
    `_set_current_user` exactly."""
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )


async def _seed_encrypted_ledger_data(
    app_db_session: AsyncSession,
    user_id: uuid.UUID,
    position_id: uuid.UUID,
) -> None:
    await insert_fills(
        app_db_session,
        user_id,
        [
            FillWrite(
                order_id="1006681717677",
                occ_symbol="SPXW260618P07275000",
                leg_index=0,
                execution_time=_EXECUTION_TIME_1,
                position_effect="OPEN",
                side="SELL",
                quantity=_QUANTITY_1,
                price_usd=_PRICE_USD_1,
            ),
            FillWrite(
                order_id="1006681717678",
                occ_symbol="SPX260717P07275000",
                leg_index=0,
                execution_time=_EXECUTION_TIME_2,
                position_effect="OPEN",
                side="BUY",
                quantity=_QUANTITY_2,
                price_usd=_PRICE_USD_2,
            ),
        ],
    )
    await insert_events(
        app_db_session,
        user_id,
        [
            EventWrite(
                position_id=position_id,
                event_type="ROLL",
                event_time=_EVENT_TIME,
                fill_ids_hash=None,
                open_debit_usd=_OPEN_DEBIT_USD,
                close_credit_usd=_CLOSE_CREDIT_USD,
                rolled_from_position_id=position_id,
            )
        ],
    )

    # The free-text case (CRYPT-02), proved with the exact primitive and
    # per-user DEK insert_fills() uses internally -- see module docstring.
    dek, key_version = await _current_dek(app_db_session, user_id)
    marker_ciphertext, marker_nonce = encrypt_field(
        _FREE_TEXT_MARKER,
        dek,
        _fill_associated_data(
            "quantity",
            user_id=user_id,
            order_id="free-text-marker",
            occ_symbol="SPXW260618P07275000",
            leg_index=0,
            execution_time=_MARKER_EXECUTION_TIME,
        ),
    )
    await app_db_session.execute(
        text(
            "INSERT INTO fills (user_id, order_id, occ_symbol, leg_index, "
            "execution_time, position_effect, side, quantity_ciphertext, "
            "quantity_nonce, key_version) VALUES (:user_id, :order_id, "
            ":occ_symbol, :leg_index, :execution_time, :position_effect, "
            ":side, :quantity_ciphertext, :quantity_nonce, :key_version)"
        ),
        {
            "user_id": user_id,
            "order_id": "free-text-marker",
            "occ_symbol": "SPXW260618P07275000",
            "leg_index": 0,
            "execution_time": _MARKER_EXECUTION_TIME,
            "position_effect": "OPEN",
            "side": "SELL",
            "quantity_ciphertext": marker_ciphertext,
            "quantity_nonce": marker_nonce,
            "key_version": key_version,
        },
    )
    await app_db_session.commit()


async def test_real_dump_restored_without_master_key_yields_no_readable_bytes(
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    await _set_current_user(app_db_session, provisioned_users.user_a)
    await _seed_encrypted_ledger_data(
        app_db_session, provisioned_users.user_a, seeded_position.position_id
    )

    url = make_url(get_settings().database_url.get_secret_value())
    host = url.host or "localhost"
    port = url.port or 5432
    user = url.username or "morai"
    password = url.password or ""
    live_db = url.database
    assert live_db is not None
    pg_env = {"PATH": os.environ.get("PATH", ""), "PGPASSWORD": password}

    dump_path = tmp_path / "confidentiality.sql"
    dump_result = await _run(
        [
            _resolve_pg_binary("pg_dump"),
            "-h",
            host,
            "-p",
            str(port),
            "-U",
            user,
            "--format=plain",
            "-t",
            "users",
            "-t",
            "positions",
            "-t",
            "fills",
            "-t",
            "events",
            "-t",
            "user_data_keys",
            "-f",
            str(dump_path),
            live_db,
        ],
        env=pg_env,
    )
    assert dump_result.returncode == 0, dump_result.stderr
    dump_text = dump_path.read_text(errors="replace")

    scratch_db = f"morai_scratch_confidentiality_{uuid.uuid4().hex[:12]}"
    try:
        create_result = await _run(
            [
                _resolve_pg_binary("createdb"),
                "-h",
                host,
                "-p",
                str(port),
                "-U",
                user,
                scratch_db,
            ],
            env=pg_env,
        )
        assert create_result.returncode == 0, create_result.stderr

        restore_result = await _run(
            [
                _resolve_pg_binary("psql"),
                "-h",
                host,
                "-p",
                str(port),
                "-U",
                user,
                "-d",
                scratch_db,
                "-v",
                "ON_ERROR_STOP=1",
                "-f",
                str(dump_path),
            ],
            env=pg_env,
        )
        assert restore_result.returncode == 0, restore_result.stderr

        # The scratch database's reading process carries no master key --
        # a fresh Settings instance (never the cached get_settings()) built
        # after the variable is removed, proving `.master_key_bytes` refuses
        # to decode rather than returning a stale value.
        monkeypatch.delenv("MORAI_MASTER_KEY", raising=False)
        with pytest.raises(RuntimeError, match="morai_master_key"):
            _ = Settings.model_validate({}).master_key_bytes

        # A real AsyncEngine against the scratch database -- not a raw
        # asyncpg.connect(), which ships no type stubs (see module
        # docstring). asyncpg's own driver still decodes bytea to real
        # Python bytes underneath; only the Python-level API surface
        # differs.
        scratch_dsn = url.set(
            drivername="postgresql+asyncpg", database=scratch_db
        ).render_as_string(hide_password=False)
        scratch_engine = create_async_engine(scratch_dsn)
        try:
            async with scratch_engine.connect() as scratch_conn:
                fill_rows = (
                    await scratch_conn.execute(
                        text(
                            "SELECT quantity_ciphertext, price_usd_ciphertext "
                            "FROM fills WHERE order_id != 'free-text-marker'"
                        )
                    )
                ).all()
                event_rows = (
                    await scratch_conn.execute(
                        text(
                            "SELECT open_debit_usd_ciphertext, "
                            "close_credit_usd_ciphertext FROM events"
                        )
                    )
                ).all()
                marker_rows = (
                    await scratch_conn.execute(
                        text(
                            "SELECT quantity_ciphertext FROM fills "
                            "WHERE order_id = 'free-text-marker'"
                        )
                    )
                ).all()
        finally:
            await scratch_engine.dispose()

        assert len(fill_rows) == 2
        assert len(event_rows) == 1
        assert len(marker_rows) == 1

        all_ciphertext_bytes: list[bytes] = []
        for row in fill_rows:
            all_ciphertext_bytes.append(_BYTES.validate_python(row[0]))
            all_ciphertext_bytes.append(_BYTES.validate_python(row[1]))
        for row in event_rows:
            all_ciphertext_bytes.append(_BYTES.validate_python(row[0]))
            all_ciphertext_bytes.append(_BYTES.validate_python(row[1]))
        marker_ciphertext = _BYTES.validate_python(marker_rows[0][0])

        # Primary assertion -- this is the arm that can actually fail on a
        # real leak: real Python bytes read back through a real AsyncEngine,
        # which decodes bytea natively, never hex text.
        for plaintext in (
            str(_QUANTITY_1).encode("utf-8"),
            str(_PRICE_USD_1).encode("utf-8"),
            str(_QUANTITY_2).encode("utf-8"),
            str(_PRICE_USD_2).encode("utf-8"),
            str(_OPEN_DEBIT_USD).encode("utf-8"),
            str(_CLOSE_CREDIT_USD).encode("utf-8"),
        ):
            for ciphertext in all_ciphertext_bytes:
                assert plaintext not in ciphertext, (
                    f"{plaintext!r} found inside a stored ciphertext value -- "
                    "encryption failed to protect this field."
                )
        assert _FREE_TEXT_MARKER not in marker_ciphertext

        # Secondary, independent arm -- the plaintext's HEX encoding must
        # also be absent from the dump text itself (the correction to the
        # naive literal grep, Pitfall 1).
        for plaintext_str in (
            str(_QUANTITY_1),
            str(_PRICE_USD_1),
            str(_QUANTITY_2),
            str(_PRICE_USD_2),
            str(_OPEN_DEBIT_USD),
            str(_CLOSE_CREDIT_USD),
        ):
            assert plaintext_str.encode("utf-8").hex() not in dump_text
        assert _FREE_TEXT_MARKER.hex() not in dump_text
    finally:
        await _run(
            [
                _resolve_pg_binary("dropdb"),
                "-h",
                host,
                "-p",
                str(port),
                "-U",
                user,
                "--if-exists",
                scratch_db,
            ],
            env=pg_env,
        )


async def test_naive_literal_grep_passes_but_hex_grep_catches_unencrypted_marker() -> (
    None
):
    """The methodology proof this module exists to establish (03-RESEARCH.md
    Pitfall 1, verified live in that research session): `pg_dump` hex-encodes
    `bytea`, so grepping a dump for a plaintext LITERAL passes even against a
    column with zero encryption. Runs entirely inside its own throwaway
    scratch database and table -- never touches the live schema, so this
    negative control cannot be mistaken for a claim about `fills`/`events`.
    """
    url = make_url(get_settings().database_url.get_secret_value())
    host = url.host or "localhost"
    port = url.port or 5432
    user = url.username or "morai"
    password = url.password or ""
    pg_env = {"PATH": os.environ.get("PATH", ""), "PGPASSWORD": password}

    scratch_db = f"morai_scratch_negctrl_{uuid.uuid4().hex[:12]}"
    dump_path = Path(f"/tmp/morai_negctrl_{uuid.uuid4().hex[:12]}.sql")
    try:
        create_result = await _run(
            [
                _resolve_pg_binary("createdb"),
                "-h",
                host,
                "-p",
                str(port),
                "-U",
                user,
                scratch_db,
            ],
            env=pg_env,
        )
        assert create_result.returncode == 0, create_result.stderr

        scratch_dsn = url.set(
            drivername="postgresql+asyncpg", database=scratch_db
        ).render_as_string(hide_password=False)
        scratch_engine = create_async_engine(scratch_dsn)
        try:
            async with scratch_engine.begin() as scratch_conn:
                await scratch_conn.execute(
                    text("CREATE TABLE leak_probe (marker bytea NOT NULL)")
                )
                await scratch_conn.execute(
                    text("INSERT INTO leak_probe (marker) VALUES (:marker)"),
                    {"marker": _FREE_TEXT_MARKER},
                )
        finally:
            await scratch_engine.dispose()

        dump_result = await _run(
            [
                _resolve_pg_binary("pg_dump"),
                "-h",
                host,
                "-p",
                str(port),
                "-U",
                user,
                "--format=plain",
                "-f",
                str(dump_path),
                scratch_db,
            ],
            env=pg_env,
        )
        assert dump_result.returncode == 0, dump_result.stderr
        dump_text = dump_path.read_text(errors="replace")

        marker_str = _FREE_TEXT_MARKER.decode("utf-8")
        # The false pass this module exists to name: the naive literal grep
        # finds NOTHING, even though the marker sits completely unencrypted
        # in the very same dump.
        assert marker_str not in dump_text
        # The correct arm: the plaintext's hex encoding IS present.
        assert _FREE_TEXT_MARKER.hex() in dump_text
    finally:
        dump_path.unlink(missing_ok=True)
        await _run(
            [
                _resolve_pg_binary("dropdb"),
                "-h",
                host,
                "-p",
                str(port),
                "-U",
                user,
                "--if-exists",
                scratch_db,
            ],
            env=pg_env,
        )
