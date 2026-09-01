"""Repair-path CLI (Phase 8, plan 08-03, SNAP-04, `D8-13`).

Rebuilds `snapshot_marks` from the raw observations already stored in
`snapshot_observations`, making no vendor call -- the second entry point
onto `morai.ingest.snapshot_repair.repair_snapshot_marks`, the same
function the `repair_snapshot_marks` Procrastinate task calls. Two entry
points exist because criterion 4 says the repair must be "runnable," and
both ship in this wave rather than a later one because criterion 4's own
wording -- "alongside the writer rather than a phase later" -- is a direct
citation of `L040`'s cost line: stopping bad writes without a runnable
repair just moves the failure mode to a later, possibly-cut phase.

`--backfill-gaps` (plan 08-03 Task 3) wires the second entry point onto
`morai.ingest.snapshot_repair.backfill_uncaptured_slot_gaps` -- the honest
`slot_not_captured` gap for an RTH slot Procrastinate's own worker never
fired a job for at all, written here rather than a second CLI so the
script is written once.

Invocations:

    uv run python tools/repair_snapshots.py <user_id> [--since <iso>]
    uv run python tools/repair_snapshots.py [--since <iso>]
    uv run python tools/repair_snapshots.py <user_id> \\
        --backfill-gaps <start-iso> <end-iso>

    railway run --service worker uv run python tools/repair_snapshots.py <user_id>

Prints only the counts each run landed -- never a DSN, a key, a token or
raw exception text (`NN-34`). An invalid user id is rejected without
echoing it back.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections.abc import Sequence
from datetime import datetime
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.db.models import SnapshotObservation
from morai.db.session import get_engine, get_session_maker
from morai.identity.rls import assert_connection_cannot_bypass_rls
from morai.ingest import snapshot_repair


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "user_id",
        nargs="?",
        default=None,
        help="a user id (UUID); every user with a stored observation if omitted",
    )
    parser.add_argument(
        "--since",
        default=None,
        help="ISO timestamp; only repair observations at or after this time",
    )
    parser.add_argument(
        "--backfill-gaps",
        nargs=2,
        metavar=("START", "END"),
        default=None,
        help=(
            "two ISO timestamps; write a slot_not_captured gap for every RTH "
            "slot in this window with no stored row at all, instead of "
            "repairing marks -- requires a user id"
        ),
    )
    return parser


async def _set_current_user(session: AsyncSession, user_id: UUID) -> None:
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )


async def _repair_one_user(user_id: UUID, *, since: datetime | None) -> None:
    session_maker = get_session_maker()
    async with session_maker() as session:
        await assert_connection_cannot_bypass_rls(session)
        await _set_current_user(session, user_id)
        outcome = await snapshot_repair.repair_snapshot_marks(
            session, user_id, since=since
        )
        await session.commit()
    print(
        f"user_id={user_id} observations_read={outcome.observations_read} "
        f"marks_written={outcome.marks_written}"
    )


async def _backfill_one_user(user_id: UUID, *, start: datetime, end: datetime) -> None:
    session_maker = get_session_maker()
    async with session_maker() as session:
        await assert_connection_cannot_bypass_rls(session)
        await _set_current_user(session, user_id)
        outcome = await snapshot_repair.backfill_uncaptured_slot_gaps(
            session, user_id, start=start, end=end
        )
        await session.commit()
    print(
        f"user_id={user_id} slots_examined={outcome.slots_examined} "
        f"gap_rows_written={outcome.gap_rows_written}"
    )


async def _every_user_with_stored_observations() -> list[UUID]:
    """A superuser, listing-only read of exactly one column -- the same
    two-tier shape `sync_all_connected_users`'s own docstring justifies:
    touches no ciphertext and writes nothing. Every repair itself then
    runs in its own subsequent `morai_app` session under that user's own
    RLS context."""
    engine = get_engine()
    async with AsyncSession(engine) as session:
        rows = (
            await session.execute(select(SnapshotObservation.user_id).distinct())
        ).all()
    return sorted({row[0] for row in rows}, key=str)


async def main(argv: Sequence[str]) -> int:
    args = _build_parser().parse_args(argv)

    user_id: UUID | None = None
    if args.user_id is not None:
        try:
            user_id = UUID(args.user_id)
        except ValueError:
            print("repair_snapshots: user id must be a valid UUID", file=sys.stderr)
            return 2

    if args.backfill_gaps is not None:
        if user_id is None:
            print(
                "repair_snapshots: --backfill-gaps requires a user id",
                file=sys.stderr,
            )
            return 2
        try:
            start = datetime.fromisoformat(args.backfill_gaps[0])
            end = datetime.fromisoformat(args.backfill_gaps[1])
        except ValueError:
            print(
                "repair_snapshots: --backfill-gaps requires two ISO timestamps",
                file=sys.stderr,
            )
            return 2
        await _backfill_one_user(user_id, start=start, end=end)
        return 0

    since: datetime | None = None
    if args.since is not None:
        try:
            since = datetime.fromisoformat(args.since)
        except ValueError:
            print(
                "repair_snapshots: --since must be an ISO timestamp",
                file=sys.stderr,
            )
            return 2

    if user_id is not None:
        await _repair_one_user(user_id, since=since)
        return 0

    for uid in await _every_user_with_stored_observations():
        await _repair_one_user(uid, since=since)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1:])))
