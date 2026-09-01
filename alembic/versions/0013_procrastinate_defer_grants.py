"""procrastinate_defer_grants

Revision ID: 0013
Revises: 0012
Create Date: 2026-09-01

Grants `morai_app` exactly what deferring a job through Procrastinate's own
API (`procrastinate_defer_jobs_v1`, migration 0002) requires -- nothing more
(task 2, INGEST-04). Hand-written, matching every prior revision.
`down_revision = "0012"`.

## Method: exercised, not reasoned about (`V092`)

Every grant below was forced by a real `InsufficientPrivilegeError`, driven
live against this project's own local Postgres 18 as `morai_app`, one grant
at a time, retrying after each until the defer succeeded. `V092` is in this
project's own record precisely because a privilege set was reasoned about
instead of exercised, and the failure surfaced at runtime in production
shape -- this migration exists to not repeat that. The loop and its exact
messages are quoted in `06-03-SUMMARY.md`; the grants list below is what the
loop actually produced, not what seemed likely in advance.

1. `INSERT ON procrastinate_jobs` -- `procrastinate_defer_jobs_v1`'s own
   `INSERT INTO procrastinate_jobs (...)`. First error:
   `permission denied for table procrastinate_jobs`.
2. `SELECT ON procrastinate_jobs` -- the same statement's `RETURNING id`
   (via the `inserted_jobs` CTE) requires `SELECT` on the returned columns
   in addition to `INSERT`, standard Postgres `RETURNING` behaviour. Same
   error text as (1); the INSERT-only grant alone did not clear it.
3. `USAGE, SELECT ON procrastinate_jobs_id_seq` -- `id bigserial` needs the
   sequence privilege to generate its own default. Error:
   `permission denied for sequence procrastinate_jobs_id_seq`.
4. `INSERT ON procrastinate_events` -- the `AFTER INSERT` trigger
   `procrastinate_trigger_status_events_insert_v1` (migration 0002) writes a
   `deferred` event row for every job insert; this fires unconditionally
   inside the same statement. Error:
   `permission denied for table procrastinate_events`.
5. `USAGE, SELECT ON procrastinate_events_id_seq` -- that trigger's own
   `id bigserial`. Error:
   `permission denied for sequence procrastinate_events_id_seq`.

No grant on `procrastinate_periodic_defers`, `procrastinate_workers`, or any
`procrastinate_*` function: the loop never asked for one, because this App
only ever calls `defer_async` (never `.periodic()`, never
`run_worker_async`) -- `api/job_queue.py`'s own docstring states that as a
design constraint, and this migration's grants confirm it holds in
practice, not only in the code that calls it. `pg_notify` (the queue-insert
trigger's own final call) needed no grant either -- it is a stable function
callable by any role, confirmed by the same live run producing zero error
naming it.

`GRANT ... ON <table>`, never `ALL TABLES IN SCHEMA` -- matching 0003's own
discipline of naming every grant individually, so a future reader can see
exactly what this migration adds and why, one line per privilege.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    bind = op.get_bind()
    # IN-01 (06-REVIEW.md): `RETURNING id` forces this `SELECT` to be
    # table-wide -- Postgres has no primitive that scopes a `RETURNING`-only
    # grant to just the rows one `INSERT` produced, and `procrastinate_jobs`
    # carries no RLS policy of its own (Procrastinate's internal schema, not
    # one this project owns). Any code running as `morai_app` is therefore
    # capable of reading every user's queued/historical `sync_user` job
    # arguments (`user_id`, `trigger`) here, not only its own -- the same
    # accepted, bounded cross-tenant read `sync_all_connected_users`
    # (`ingest/schwab_sync.py`) already discloses in its own docstring: a
    # UUID and an enum value, no secrets, no ciphertext. Nothing broader
    # than `RETURNING` requires was granted; this comment exists so a future
    # reader does not have to re-derive that the scope is accepted rather
    # than an oversight.
    bind.execute(sa.text("GRANT INSERT, SELECT ON procrastinate_jobs TO morai_app"))
    bind.execute(
        sa.text(
            "GRANT USAGE, SELECT ON procrastinate_jobs_id_seq TO morai_app"
        )
    )
    bind.execute(sa.text("GRANT INSERT ON procrastinate_events TO morai_app"))
    bind.execute(
        sa.text(
            "GRANT USAGE, SELECT ON procrastinate_events_id_seq TO morai_app"
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "REVOKE USAGE, SELECT ON procrastinate_events_id_seq FROM morai_app"
        )
    )
    bind.execute(sa.text("REVOKE INSERT ON procrastinate_events FROM morai_app"))
    bind.execute(
        sa.text(
            "REVOKE USAGE, SELECT ON procrastinate_jobs_id_seq FROM morai_app"
        )
    )
    bind.execute(sa.text("REVOKE INSERT, SELECT ON procrastinate_jobs FROM morai_app"))
