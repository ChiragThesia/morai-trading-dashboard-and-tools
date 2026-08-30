from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """The declarative base every ORM model inherits. Lives here, separate from any
    model module, so `alembic/env.py` imports cleanly before any model exists."""
