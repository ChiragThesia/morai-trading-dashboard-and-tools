"""KEK rotation, the operator entry point (D3-06, T-03-22, T-03-23,
T-03-24).

Runs on the superuser engine (`get_engine`, not `get_app_engine`) -- this is
DDL-class maintenance across every user's data key, not a single user's
request, and `user_data_keys` carries no `UPDATE` grant for the app role
(migration 0007). Prints only the count of rows re-wrapped -- never either
key, and never a fragment of one (NN-34).

Usage, both keys base64 of exactly 32 bytes:

    OLD_MASTER_KEY=<base64> NEW_MASTER_KEY=<base64> uv run python \\
        tools/rotate_kek.py

or as explicit arguments:

    uv run python tools/rotate_kek.py --old-key <base64> --new-key <base64>

**This has not been run against a deployment.** Ships as a runnable,
committed script and an operator step -- never as a claim that it has been
used in production (`.claude/rules/workflow.md`: state what you cannot
verify, rather than softening the claim). Modeled on
`tools/isolation_smoke.py`'s own shape.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import binascii
import os
import sys

from sqlalchemy.ext.asyncio import AsyncSession

from morai.crypto.rotation import rotate_kek
from morai.db.session import get_engine


def _decode_key(raw: str, *, label: str) -> bytes:
    """Base64-decodes `raw` to exactly 32 bytes, or exits naming only
    `label` -- never the rejected value (NN-34), same discipline as
    `Settings.master_key_bytes`."""
    decoded: bytes | None
    try:
        decoded = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError):
        decoded = None
    if decoded is None or len(decoded) != 32:
        print(
            f"rotate_kek: {label} must be base64 of exactly 32 bytes for "
            "AES-256-GCM; its value is withheld deliberately (NN-34)",
            file=sys.stderr,
        )
        raise SystemExit(2)
    return decoded


async def _run(old_kek: bytes, new_kek: bytes) -> int:
    engine = get_engine()
    async with AsyncSession(engine) as session:
        count = await rotate_kek(session, old_kek, new_kek)
        await session.commit()
    await engine.dispose()
    return count


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--old-key",
        default=os.environ.get("OLD_MASTER_KEY"),
        help="base64 of the current master key (32 bytes); or OLD_MASTER_KEY",
    )
    parser.add_argument(
        "--new-key",
        default=os.environ.get("NEW_MASTER_KEY"),
        help="base64 of the replacement master key (32 bytes); or NEW_MASTER_KEY",
    )
    args = parser.parse_args()

    if not args.old_key or not args.new_key:
        print(
            "rotate_kek: both --old-key and --new-key (or OLD_MASTER_KEY / "
            "NEW_MASTER_KEY) are required",
            file=sys.stderr,
        )
        return 2

    old_kek = _decode_key(args.old_key, label="the old key")
    new_kek = _decode_key(args.new_key, label="the new key")

    count = asyncio.run(_run(old_kek, new_kek))
    print(f"rotate_kek: re-wrapped {count} data key(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
