"""Criterion 1a (CRYPT-05): a real `pg_dump`, restored into a scratch
database by a process with no master key in its environment, yields no
readable per-user trade detail -- price, quantity, per-trade P&L or
free-text field.

## The one exception, and why this module now enforces it

`reconciliation_runs`' four aggregates (`realised_pnl_usd`,
`commissions_usd`, `cash_delta_usd`, `signed_difference_usd`) are plaintext
`NUMERIC(14,4)` on purpose. `D9-13` requires the stored row to answer "how
far off, and in which direction" on its own, and `D9-15` requires
`GET /reconciliation/status` to be cheap enough to poll before rendering --
neither survives a data-key unwrap. Migration 0016 says so in its own
docstring.

A real `pg_dump` of a seeded row, no master key involved, confirmed the
readable P&L on 2026-09-02. The owner narrowed criterion 1 rather than
encrypting the columns. `_ALLOWED_PLAINTEXT_MONEY_COLUMNS` below is that
line, made executable: exactly those four columns, and
`test_only_the_reconciliation_aggregates_store_plaintext_money` fails on
any fifth.

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
_STR: TypeAdapter[str] = TypeAdapter(str)

# The one deliberate hole in criterion 1, ruled on by the owner 2026-09-02.
# `reconciliation_runs` stores its four aggregates as plaintext
# `NUMERIC(14,4)` so `GET /reconciliation/status` answers "how far off, in
# which direction" without unwrapping a data key (`D9-13`, `D9-15`, migration
# 0016's own docstring). Nothing else may.
#
# An allow-list, never a deny-list: a money column a later migration adds
# fails `test_only_the_reconciliation_aggregates_store_plaintext_money`
# on its first run, and the author has to either encrypt it or come here and
# argue for it.
_ALLOWED_PLAINTEXT_MONEY_COLUMNS: frozenset[tuple[str, str]] = frozenset(
    {
        ("reconciliation_runs", "realised_pnl_usd"),
        ("reconciliation_runs", "commissions_usd"),
        ("reconciliation_runs", "cash_delta_usd"),
        ("reconciliation_runs", "signed_difference_usd"),
    }
)

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


async def _public_base_tables(session: AsyncSession) -> list[str]:
    """Every `public` base table, read from the catalog rather than written
    down. Follows PR #34's fix to `tests/test_isolation.py`, which replaced
    that suite's hand-written five-table list with a `pg_attribute`
    derivation for exactly this reason: by Phase 9 the schema had grown six
    user-scoped tables no hand-written list named."""
    rows = (
        await session.execute(
            text(
                "SELECT c.relname FROM pg_class c "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'public' AND c.relkind = 'r' "
                "ORDER BY c.relname"
            )
        )
    ).all()
    return [_STR.validate_python(row[0]) for row in rows]


async def _plaintext_money_columns(session: AsyncSession) -> set[tuple[str, str]]:
    """Every `public` base-table column that stores money in the clear.

    Money in this schema is `NUMERIC` and carries a `usd` in its name
    (`NN-8`, enforced by `tests/test_money_column_naming.py`). Ciphertext and
    nonce columns are `bytea` and carry `usd` only inside a longer name, so
    excluding `bytea` separates encrypted money from plaintext money with no
    column list to keep in sync.

    The ceiling: a future migration could store money as `text` under a name
    with no `usd` in it, and this derivation would miss it. `NN-8` and
    `tests/test_money_column_naming.py` are what make that shape a violation
    before it reaches the database."""
    rows = (
        await session.execute(
            text(
                "SELECT c.relname, a.attname FROM pg_class c "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "JOIN pg_attribute a ON a.attrelid = c.oid "
                "WHERE n.nspname = 'public' AND c.relkind = 'r' "
                "AND a.attnum > 0 AND NOT a.attisdropped "
                "AND format_type(a.atttypid, a.atttypmod) <> 'bytea' "
                "AND (format_type(a.atttypid, a.atttypmod) LIKE 'numeric%' "
                "OR a.attname ~ 'usd') "
                "ORDER BY c.relname, a.attname"
            )
        )
    ).all()
    return {
        (_STR.validate_python(row[0]), _STR.validate_python(row[1])) for row in rows
    }


async def _ciphertext_columns(session: AsyncSession) -> list[tuple[str, str]]:
    """Every `public` base-table ciphertext column. Derived, not listed --
    the hardcoded `fills`/`events` pair this replaced named two of the six
    tables that now carry ciphertext."""
    rows = (
        await session.execute(
            text(
                "SELECT c.relname, a.attname FROM pg_class c "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "JOIN pg_attribute a ON a.attrelid = c.oid "
                "WHERE n.nspname = 'public' AND c.relkind = 'r' "
                "AND a.attnum > 0 AND NOT a.attisdropped "
                "AND a.attname ~ '_ciphertext$' "
                "ORDER BY c.relname, a.attname"
            )
        )
    ).all()
    return [
        (_STR.validate_python(row[0]), _STR.validate_python(row[1])) for row in rows
    ]


async def test_only_the_reconciliation_aggregates_store_plaintext_money(
    app_db_session: AsyncSession,
) -> None:
    """Criterion 1's real boundary, made executable.

    Criterion 1 used to claim a stolen dump yields no readable P&L, flat.
    Migration 0016 made that false on purpose: `reconciliation_runs` stores
    four aggregates as plaintext `NUMERIC(14,4)` so the status endpoint can
    report drift without unwrapping a data key (`D9-13`, `D9-15`). A real
    `pg_dump` of a seeded row proved it, 2026-09-02.

    The owner narrowed the criterion rather than encrypting the columns. This
    test is what keeps the narrowed line honest: the allow-list holds exactly
    those four columns, and any other plaintext money column fails here on the
    migration that adds it."""
    tables = await _public_base_tables(app_db_session)
    # Guards the guard. An empty catalog read would make the comparison below
    # a claim about nothing. 21 is the count at Phase 9 -- `>=` never needs
    # bumping when a table lands, and a drop below it is itself a signal.
    assert len(tables) >= 21

    assert await _plaintext_money_columns(app_db_session) == (
        _ALLOWED_PLAINTEXT_MONEY_COLUMNS
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

    # The whole database, not a `-t` list. The five-table list this replaced
    # named five of the twenty-one tables the schema now has -- a leak into
    # any of the other sixteen was simply outside the bytes this test reads.
    # A `-t` list rebuilt from the catalog would still be wrong: `-t` omits
    # the enum types the procrastinate tables declare, and the restore fails.
    ciphertext_columns = await _ciphertext_columns(app_db_session)
    assert len(ciphertext_columns) >= 10

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
            "-f",
            str(dump_path),
            live_db,
        ],
        env=pg_env,
    )
    assert dump_result.returncode == 0, dump_result.stderr
    dump_text = dump_path.read_text(errors="replace")

    # Guards the guard, against the catalog rather than a count: every table
    # Postgres reports must appear in the dump this test then greps. A
    # narrowed dump makes every assertion below a claim about less than it
    # says. 21 is the count at Phase 9; `>=` never needs bumping.
    tables = await _public_base_tables(app_db_session)
    assert len(tables) >= 21
    for table in tables:
        assert f"CREATE TABLE public.{table} " in dump_text

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
        all_ciphertext_bytes: list[bytes] = []
        scratch_engine = create_async_engine(scratch_dsn)
        try:
            async with scratch_engine.connect() as scratch_conn:
                for table, column in ciphertext_columns:
                    # Both identifiers came out of the catalog above, never
                    # out of a test parameter -- but interpolating an
                    # identifier at all earns the check.
                    assert table.isidentifier() and column.isidentifier()
                    rows = (
                        await scratch_conn.execute(
                            text(f"SELECT {column} FROM {table}")
                        )
                    ).all()
                    all_ciphertext_bytes.extend(
                        _BYTES.validate_python(row[0])
                        for row in rows
                        if row[0] is not None
                    )
        finally:
            await scratch_engine.dispose()

        # Guards the guard: two fills x two columns, one event x two, plus the
        # free-text marker's one. An empty read would make every assertion
        # below pass while proving nothing.
        assert len(all_ciphertext_bytes) >= 7

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
        for ciphertext in all_ciphertext_bytes:
            assert _FREE_TEXT_MARKER not in ciphertext

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
