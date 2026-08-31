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

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text, false, func
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
