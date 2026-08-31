"""D2-10's deploy-time isolation run -- not part of the regular suite, not
imported by anything under `src/`.

Runs the four HTTP assertions from plan 02-02 Task 2's admin-exemption cases
against a live deployment, now against `positions` (03-06): an admin cannot
read another user's position (404), the 404 for that real row is
byte-identical (status, body, headers apart from `X-Request-Id`/`Date`) to
the 404 for a UUID matching no row anywhere, and the admin's own listing
never includes it.

Usage, once plan 02-06's login route exists to obtain both cookies:

    uv run python tools/isolation_smoke.py \\
        --base-url https://web-production-183cf.up.railway.app \\
        --admin-cookie <morai_session for the admin user> \\
        --user-cookie <morai_session for a non-admin user who owns a position>

The admin cookie belongs to a user with `is_admin=True`; the user cookie
belongs to any non-admin user who owns at least one `positions` row (seed
one directly, or via an account that has traded).

**This has not been run against a deployment.** Deploys are blocked by the
permission classifier active in the session that wrote it. It ships as a
runnable, committed script and an operator step
(`docs/operations/phase-2-operator-steps.md`, plan 02-06) -- never as a claim
that it passed (`.claude/rules/workflow.md`: state what you cannot verify,
rather than softening the claim).
"""

from __future__ import annotations

import argparse
import sys
from uuid import uuid4

import httpx

_COOKIE_NAME = "morai_session"

# Per-response and per-request headers that legitimately differ between two
# otherwise-identical requests -- comparing them would report a false
# mismatch, not the disclosure this script exists to catch.
_IGNORED_HEADERS = {"x-request-id", "date", "content-length"}


def _get(client: httpx.Client, path: str, cookie: str) -> httpx.Response:
    return client.get(path, cookies={_COOKIE_NAME: cookie})


def _filtered_headers(response: httpx.Response) -> dict[str, str]:
    return {
        key.lower(): value
        for key, value in response.headers.items()
        if key.lower() not in _IGNORED_HEADERS
    }


def run(base_url: str, admin_cookie: str, user_cookie: str) -> list[str]:
    """Returns a list of failure descriptions -- empty means every assertion
    passed."""
    failures: list[str] = []

    with httpx.Client(base_url=base_url) as client:
        listing = _get(client, "/gate/positions", user_cookie)
        rows = listing.json() if listing.status_code == 200 else []
        if listing.status_code != 200 or not rows:
            failures.append(
                "could not discover the user's own position via "
                f"GET /gate/positions (status {listing.status_code}, "
                f"{len(rows)} rows) -- seed a position for this user before "
                "running this script"
            )
            return failures
        user_position_id = rows[0]["position_id"]

        real_404 = _get(client, f"/gate/positions/{user_position_id}", admin_cookie)
        if real_404.status_code != 404:
            failures.append(
                "admin reading another user's real position returned "
                f"{real_404.status_code}, expected 404"
            )

        fake_404 = _get(client, f"/gate/positions/{uuid4()}", admin_cookie)
        if fake_404.status_code != 404:
            failures.append(
                "admin reading a nonexistent position id returned "
                f"{fake_404.status_code}, expected 404"
            )

        if real_404.content != fake_404.content:
            failures.append(
                "the two 404 bodies differ in bytes -- this discloses that "
                "the real position exists"
            )

        if _filtered_headers(real_404) != _filtered_headers(fake_404):
            failures.append(
                "the two 404 responses have differing headers outside "
                "X-Request-Id/Date/Content-Length"
            )

        admin_listing = _get(client, "/gate/positions", admin_cookie)
        admin_position_ids = {row["position_id"] for row in admin_listing.json()}
        if user_position_id in admin_position_ids:
            failures.append(
                "the admin's own position listing includes another user's row"
            )

    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--admin-cookie", required=True)
    parser.add_argument("--user-cookie", required=True)
    args = parser.parse_args()

    failures = run(args.base_url, args.admin_cookie, args.user_cookie)

    if not failures:
        print("isolation_smoke: all checks passed")
        return 0

    print("isolation_smoke: FAILED", file=sys.stderr)
    for failure in failures:
        print(f"  - {failure}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
