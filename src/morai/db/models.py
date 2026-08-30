"""ORM models (D-13, D-04).

`GateMoneyProbe` is permanent production surface for the life of Phase 1, not
scaffolding — it proves OPS-03 on the deployed Railway service, not only in CI.
Phase 3 drops this table with an explicit migration when the real schema lands.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Numeric, func
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
