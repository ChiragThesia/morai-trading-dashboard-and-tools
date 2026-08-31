"""ORM models (D-13, D-04).

`GateMoneyProbe` is permanent production surface for the life of Phase 1, not
scaffolding — it proves OPS-03 on the deployed Railway service, not only in CI.
Phase 3 drops this table with an explicit migration when the real schema lands.

Phase 2 adds `User`, `Session`, `SetupToken`, `AuditLog` and
`GateUserScopedProbe` — see `alembic/versions/0003_identity_and_rls.py` for the
`morai_app` role, the RLS policies, and the reasoning behind which of these
tables carry one and which deliberately don't. UUID primary keys throughout:
Phase 3's per-user data key is keyed by whatever identifies a user here, so the
identifier's shape outlives this phase, and a UUID means no sequence to grant.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    LargeBinary,
    Numeric,
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


class GateMoneyProbe(Base):
    __tablename__ = "gate_money_probe"

    id: Mapped[int] = mapped_column(primary_key=True)
    # `_usd` suffix is D-04's requirement -- the only NN-8 enforcement that reaches
    # SQL, where no Python type is in play, and where v1's `openNetDebit` bug lived.
    amount_usd: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


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


class GateUserScopedProbe(Base):
    """Permanent surface for the life of Phase 2, not scaffolding -- it proves
    AUTH-07's RLS isolation on the deployed Railway service, not only in CI,
    exactly mirroring `GateMoneyProbe`'s role in Phase 1.

    **Phase 3 must drop this table with an explicit migration** once real
    trading tables exist to prove isolation against instead. Written here, not
    only in a plan, so the obligation travels with the code.
    """

    __tablename__ = "gate_user_scoped_probe"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    note: Mapped[str] = mapped_column(Text, nullable=False)
