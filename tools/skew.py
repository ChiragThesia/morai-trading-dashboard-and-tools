"""Vertical skew finder: fetches one user's live Schwab option chain and
prints the 25-delta risk reversal, its 10-delta wing pair, and ATM IV for one
expiry. Thin shell only -- `tools/` sits outside `tools/gate.sh`'s ruff/
basedpyright/mypy scope, so every number printed here is computed in
`morai.analytics.skew`, which the gate does check.

Operator tool: connects on the superuser engine, exactly as
`tools/create_admin.py` does, bypassing RLS by design.

Invocations:

    uv run python tools/skew.py --symbol SPX --expiry 2026-10-16
    uv run python tools/skew.py --symbol SPX --expiry 2026-10-16 --username alice --json
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import date
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from morai.analytics.skew import SkewMetric, SkewSnapshot, compute_skew
from morai.db.models import SchwabConnection, User
from morai.db.session import get_engine
from morai.settings import get_settings
from morai.vendor.connections import schwab_client_for_user
from morai.vendor.schwab_adapter import SchwabAuthAdapter


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbol", required=True, help="underlying symbol, e.g. SPX")
    parser.add_argument(
        "--expiry",
        required=True,
        type=date.fromisoformat,
        help="expiry date, YYYY-MM-DD",
    )
    parser.add_argument(
        "--username", default=None, help="which user's connection to use"
    )
    parser.add_argument("--json", action="store_true", help="print snapshot as JSON")
    return parser


async def _resolve_user_id(session: AsyncSession, username: str | None) -> UUID | None:
    """A named user must have a `schwab_connections` row; an unnamed lookup
    requires exactly one connection to exist project-wide -- never guesses.
    Prints its own error and returns `None` on failure."""
    if username is not None:
        user_row = (
            await session.execute(select(User.id).where(User.username == username))
        ).first()
        if user_row is None:
            print(f"No user named {username!r}.", file=sys.stderr)
            return None
        user_id = user_row[0]
        connection_row = (
            await session.execute(
                select(SchwabConnection.user_id).where(
                    SchwabConnection.user_id == user_id
                )
            )
        ).first()
        if connection_row is None:
            print(f"User {username!r} has no Schwab connection.", file=sys.stderr)
            return None
        return user_id

    connection_rows = (await session.execute(select(SchwabConnection.user_id))).all()
    if len(connection_rows) == 0:
        print("No Schwab connection exists for any user.", file=sys.stderr)
        return None
    if len(connection_rows) > 1:
        print(
            "More than one Schwab connection exists -- pass --username.",
            file=sys.stderr,
        )
        return None
    return connection_rows[0][0]


def _format_metric(label: str, metric: SkewMetric) -> str:
    if metric.value is not None:
        return f"{label:<16}{metric.value:.2f}%"
    return f"{label:<16}{metric.reason}"


def _print_snapshot(snapshot: SkewSnapshot, *, as_json: bool) -> None:
    if as_json:
        print(snapshot.model_dump_json(indent=2))
        return
    underlying = (
        f"{snapshot.underlying_price:.2f}"
        if snapshot.underlying_price is not None
        else "unavailable"
    )
    print(f"{'underlying_price':<16}{underlying}")
    for label, metric in (
        ("atm_put_iv_pct", snapshot.atm_put_iv_pct),
        ("put_iv_25_pct", snapshot.put_iv_25_pct),
        ("call_iv_25_pct", snapshot.call_iv_25_pct),
        ("rr_25_pct", snapshot.rr_25_pct),
        ("put_iv_10_pct", snapshot.put_iv_10_pct),
        ("call_iv_10_pct", snapshot.call_iv_10_pct),
        ("rr_10_pct", snapshot.rr_10_pct),
    ):
        print(_format_metric(label, metric))


async def main(args: argparse.Namespace) -> int:
    session_maker = async_sessionmaker(get_engine(), expire_on_commit=False)
    async with session_maker() as session:
        user_id = await _resolve_user_id(session, args.username)
        if user_id is None:
            return 1

        auth = SchwabAuthAdapter(get_settings().schwab_credentials)
        async with schwab_client_for_user(session, user_id, auth) as client:
            payload = await client.get_option_chain(args.symbol)
        # `schwab_client_for_user` does not commit -- a token refreshed
        # inside the block above is sitting uncommitted until this line.
        await session.commit()

    try:
        snapshot = compute_skew(payload, expiry=args.expiry)
    except (ValueError, ValidationError) as exc:
        print(str(exc), file=sys.stderr)
        return 1

    _print_snapshot(snapshot, as_json=args.json)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main(_build_parser().parse_args())))
