"""ORM models (D-13, D-04).

`GateMoneyProbe` and `GateUserScopedProbe` -- Phase 1's and Phase 2's deployed
isolation/round-trip proofs -- carried an explicit obligation in this file's
own docstring for the life of their phases: drop them once real trading
tables existed to prove the same things against. Migration 0009 discharges
that obligation. Plan 03-06 moved both proofs onto the real trading tables
below *first*, observed green, and only then did 03-07 drop the two probe
tables and their models -- neither class exists here any more, and this
paragraph records why, not what to do next (the "do it" instruction has
already been carried out).

Phase 2 adds `User`, `Session`, `SetupToken`, `AuditLog` — see
`alembic/versions/0003_identity_and_rls.py` for the `morai_app` role, the RLS
policies, and the reasoning behind which of these tables carry one and which
deliberately don't. UUID primary keys throughout: Phase 3's per-user data key
is keyed by whatever identifies a user here, so the identifier's shape
outlives this phase, and a UUID means no sequence to grant.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    LargeBinary,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    false,
    func,
)
from sqlalchemy import text as sa_text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from morai.db.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    username: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    # Nullable: a freshly-created account has no password until its setup link
    # is consumed (AUTH-01/AUTH-02).
    password_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    is_admin: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=false()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    token_hash: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class SetupToken(Base):
    __tablename__ = "setup_tokens"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    token_hash: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    purpose: Mapped[str] = mapped_column(String, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    reader_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    subject_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class UserDataKey(Base):
    """The per-user wrapped AES-256-GCM data key (CRYPT-01, D3-05, D3-06,
    D3-07). Only `wrapped_dek`/`wrap_nonce` are stored -- the raw DEK is
    generated, wrapped and discarded in-process by
    `morai.ledger.fills.provision_data_key`, and never written here. No
    `UPDATE` grant (migration 0007): re-wrapping under a rotated KEK is an
    operator script on the superuser engine, never an app-role write.
    """

    __tablename__ = "user_data_keys"

    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), primary_key=True
    )
    key_version: Mapped[int] = mapped_column(
        SmallInteger, primary_key=True, server_default=sa_text("1")
    )
    wrapped_dek: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    wrap_nonce: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Fill(Base):
    """One trade execution, price and quantity encrypted under the writing
    user's own data key (CRYPT-02, D3-01, D3-12, D3-15). Composite primary
    key carries every discriminating column, including `leg_index`, whose
    value is a single literal today -- `NN-1`: "it never varies today" is
    not "it can never vary".

    `insert_fills()` in `morai.ledger.fills` is the only intended way into
    this table -- see `__init__` below for the enforcement, and its own
    honest ceiling.
    """

    __tablename__ = "fills"

    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), primary_key=True
    )
    order_id: Mapped[str] = mapped_column(Text, primary_key=True)
    occ_symbol: Mapped[str] = mapped_column(Text, primary_key=True)
    leg_index: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    execution_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), primary_key=True
    )
    position_effect: Mapped[str] = mapped_column(Text, nullable=False)
    side: Mapped[str] = mapped_column(Text, nullable=False)
    quantity_ciphertext: Mapped[bytes | None] = mapped_column(
        LargeBinary, nullable=True
    )
    quantity_nonce: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    price_usd_ciphertext: Mapped[bytes | None] = mapped_column(
        LargeBinary, nullable=True
    )
    price_usd_nonce: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    key_version: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    def __init__(self, *, _write_token: object, **kwargs: object) -> None:
        """`_write_token` has no default -- omitting it is a missing-argument
        error at the call site under basedpyright/mypy (Task 3's compile-time
        gate), not a silently-accepted `None` (D3-13). Passing anything but
        the sentinel `insert_fills()` holds raises here, at runtime (Task
        2's companion guard) -- the same split `identity/audit.py` already
        documents: type checkers verify shapes, not provenance.

        SQLAlchemy's ORM does not call `__init__` when reconstructing a
        `Fill` from a query result -- it uses `__new__` plus direct
        attribute restoration, so an ordinary `SELECT` is unaffected by
        this guard. The honest ceiling: a Core `insert(Fill.__table__)`
        statement naming the table bypasses this constructor entirely, so
        this blocks the ergonomic second path, not every conceivable one.
        """
        from morai.ledger.fills import (
            _FILL_WRITE_TOKEN,  # pyright: ignore[reportPrivateUsage]  # why: the sentinel and its only legitimate holder (insert_fills) live in one module by design (D3-13); the leading underscore marks it module-private in intent, not a real access boundary between these two cooperating modules -- same convention tests/test_isolation.py already uses for _seed_session.
        )

        if _write_token is not _FILL_WRITE_TOKEN:
            raise RuntimeError(
                "Fill must be constructed by insert_fills() -- constructing "
                "one directly bypasses encryption (D3-13, D3-15)."
            )
        super().__init__(**kwargs)


class Position(Base):
    """One traded structure -- a calendar or diagonal, front and back legs
    grouped under this row (CRYPT-02, migration 0008). No stored status
    column: a position's closed state is derived from net quantity per leg
    (LEDGER-05), the exact thing a status column's absence guards against
    -- calendar `65aac62e` reported open after its real close order fully
    unwound both legs, because the status column had drifted from the
    fills that actually closed it.
    """

    __tablename__ = "positions"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    opened_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    closed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Leg(Base):
    """One leg (front or back) of a position (migration 0008). `user_id` is
    denormalized from `positions` deliberately, so its own RLS policy
    evaluates without a join to `positions` -- matching every other
    user-scoped table in this schema rather than inventing a join-based
    policy this codebase has never used. `root` is the settlement-style
    discriminator (`SPX` AM vs `SPXW` PM) at the grain LEDGER-07 needs it:
    per leg, not per position, since a PM-settled front and an AM-settled
    back can coexist inside one calendar.
    """

    __tablename__ = "legs"
    __table_args__: tuple[UniqueConstraint] = (
        UniqueConstraint(
            "position_id", "leg_role", name="legs_position_id_leg_role_key"
        ),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    position_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("positions.id"), nullable=False
    )
    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    leg_role: Mapped[str] = mapped_column(Text, nullable=False)
    occ_symbol: Mapped[str] = mapped_column(Text, nullable=False)
    root: Mapped[str] = mapped_column(Text, nullable=False)


class SchwabConnection(Base):
    """One user's Schwab OAuth connection (migration 0010, CONN-01..CONN-07).

    `user_id` is the primary key -- one row per user by construction, not by
    a runtime uniqueness check. That is what makes D4-09's repair-in-place
    (`UPDATE ... WHERE user_id = :uid`, `INSERT` only when `rowcount` is
    zero) natural rather than enforced.

    No `_write_token` constructor gate, unlike `Fill`: that gate exists
    because `fills` is immutable and had a documented second-writer threat
    (D3-13). This table's write path is one function
    (`morai.vendor.connections.upsert_connection`) and nothing in
    CONTEXT.md asks for a compile-time single-writer gate here -- recorded
    as a deliberate omission, not an oversight.

    `token_created_at` is plaintext by design: it is `schwab-py`'s own
    `TokenMetadata.creation_timestamp`, which the vendor explicitly does not
    update on an ordinary refresh, and it is connection metadata, not
    trading data -- the same precedent `positions.opened_at` already sets.
    """

    __tablename__ = "schwab_connections"

    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), primary_key=True
    )
    account_hash_ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    account_hash_nonce: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    token_ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    token_nonce: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    key_version: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    token_created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    reauth_notified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class BrokerTransaction(Base):
    """The broker's own raw transaction record, independent of the
    derivation pipeline by construction (D6-02, migration 0011). Composite
    primary key is the natural `(user_id, activity_id)` pair -- never a
    hashed surrogate: `salvage/invariants.md`'s WR-A3 entry records v1's
    `hexToUuid` dropping a hex nibble and silently colliding two real
    transactions onto one identifier, which its `onConflictDoNothing`
    clause then dropped (`NN-1`).

    `insert_broker_transactions()` in `morai.ingest.broker_transactions` is
    the only intended way into this table -- see `__init__` below for the
    enforcement, mirroring `Fill.__init__` exactly, including its own
    honest ceiling: a Core `insert(BrokerTransaction.__table__)` statement
    naming the table bypasses this constructor entirely, so this blocks
    the ergonomic second path, not every conceivable one. This table is
    Phase 9's comparison source precisely when the derived numbers are in
    doubt, so a second writer has to be a type error rather than something
    review catches (D6-02).
    """

    __tablename__ = "broker_transactions"

    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), primary_key=True
    )
    activity_id: Mapped[str] = mapped_column(Text, primary_key=True)
    transaction_type: Mapped[str] = mapped_column(Text, nullable=False)
    transaction_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    order_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    raw_nonce: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    key_version: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    def __init__(self, *, _write_token: object, **kwargs: object) -> None:
        """`_write_token` has no default -- omitting it is a missing-argument
        error at the call site under basedpyright/mypy, not a silently
        accepted `None`. Passing anything but the sentinel
        `insert_broker_transactions()` holds raises here, at runtime --
        mirrors `Fill.__init__`'s identical split exactly (D6-02): type
        checkers verify shapes, not provenance.

        SQLAlchemy's ORM does not call `__init__` when reconstructing a row
        from a query result -- it uses `__new__` plus direct attribute
        restoration, so an ordinary `SELECT` is unaffected by this guard.
        The honest ceiling: a Core `insert(BrokerTransaction.__table__)`
        statement bypasses this constructor entirely, so this blocks the
        ergonomic second path, not every conceivable one.
        """
        from morai.ingest.broker_transactions import (
            _BROKER_TRANSACTION_WRITE_TOKEN,  # pyright: ignore[reportPrivateUsage]  # why: the sentinel and its only legitimate holder (insert_broker_transactions) live in one module by design (D6-02); the leading underscore marks it module-private in intent, not a real access boundary between these two cooperating modules -- same convention Fill.__init__ already uses.
        )

        if _write_token is not _BROKER_TRANSACTION_WRITE_TOKEN:
            raise RuntimeError(
                "BrokerTransaction must be constructed by "
                "insert_broker_transactions() -- constructing one directly "
                "bypasses the derivation-pipeline independence D6-02 "
                "exists to guarantee."
            )
        super().__init__(**kwargs)


class Event(Base):
    """One derived ledger event -- OPEN, CLOSE, ROLL or SETTLEMENT
    (migration 0008, CRYPT-02). A ROLL's `open_debit_usd`/`close_credit_usd`
    stay split across two ciphertext/nonce column pairs, never netted into
    one figure -- the `roll_has_both_legs` CHECK constraint on this table
    makes a netted-only ROLL unstorable regardless of which caller writes
    the row (D3-09, LEDGER-04). Both pairs are nullable: a non-ROLL event
    that never opens or never closes leaves the relevant pair `NULL`,
    never a sentinel, never zero (NN-16, D3-11).

    `morai.ledger.events.insert_events()` is this phase's write path into
    this table. Unlike `Fill`, this model carries no `_write_token`
    sentinel gate -- 03-RESEARCH.md's Open Question 2 treats a
    compile-time-checked single-writer gate on `events` as Phase 5's
    concern, once Phase 5 actually derives events from fills and a second
    writer becomes a real temptation.
    """

    __tablename__ = "events"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    position_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("positions.id"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    event_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    fill_ids_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    open_debit_usd_ciphertext: Mapped[bytes | None] = mapped_column(
        LargeBinary, nullable=True
    )
    open_debit_usd_nonce: Mapped[bytes | None] = mapped_column(
        LargeBinary, nullable=True
    )
    close_credit_usd_ciphertext: Mapped[bytes | None] = mapped_column(
        LargeBinary, nullable=True
    )
    close_credit_usd_nonce: Mapped[bytes | None] = mapped_column(
        LargeBinary, nullable=True
    )
    key_version: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
