"""The Schwab connection routes (CONN-01, CONN-02, CONN-04, CONN-07).

Every route declares its contract by return type annotation, never
`response_model=` (D-11), matching `api/routes_identity.py`.

**`NN-34` discipline above every other route in this codebase.** The
callback's own received URL, its `code` query parameter and its `state` are
bearer-equivalent secrets. Nothing in this module ever logs the received
URL, the raw code, or the state, and none of the three is ever put into an
exception message -- `api/errors.py`'s unhandled handler logs only
`request.url.path`, never the query string, and that stays true here too.

**Warning for a future reader who wants to debug a production request:**
Hypercorn's default access-log format (`Config.access_log_format`) includes
the full request line, path and query string both. It is off by default in
this project's pinned 0.18.0 -- `Config().accesslog is None` unless
explicitly set -- but the moment anyone reaches for `--access-logfile -` to
debug a Railway request without first stripping the query string from the
format, every past and future callback's `code` parameter leaks to the
platform log. This is the one real leak vector research found (Common
Pitfall 1); an in-process ASGITransport test structurally cannot observe a
real server's access log, so this stays a Manual-Only item in
`04-VALIDATION.md` and no test here pretends otherwise.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.api.job_queue import defer_manual_sync
from morai.api.models_connections import (
    CallbackResponse,
    ConnectionResponse,
    ConnectResponse,
    SyncTriggeredResponse,
)
from morai.db.session import get_db_session
from morai.identity.rls import require_rls_context
from morai.identity.sessions import AuthenticatedUser, get_current_user
from morai.identity.setup_tokens import TokenPurpose, consume_token, issue_token
from morai.ingest.sync_runs import read_sync_runs
from morai.settings import get_settings
from morai.vendor.connections import (
    derive_connection_health,
    read_connection,
    upsert_connection,
)
from morai.vendor.protocol import SchwabAuth
from morai.vendor.schwab_adapter import SchwabAuthAdapter

router = APIRouter()

# Named beside `routes_identity.py`'s `_SETUP_TOKEN_TTL`/`_RESET_TOKEN_TTL`
# (04-VALIDATION.md's own scope decision). Long enough to cover a real
# user's browser round-trip through Schwab's login/2FA/consent flow;
# not a measured constant (Assumptions Log A1, 04-RESEARCH.md).
_OAUTH_STATE_TTL = timedelta(minutes=15)


def get_schwab_auth() -> SchwabAuth:
    """The real adapter in production; tests override this via FastAPI's
    `dependency_overrides` with a `Protocol` fake -- zero network calls in
    this plan's own test suite (D4-05, D4-14)."""
    return SchwabAuthAdapter(get_settings().schwab_credentials)


@router.post("/schwab/connect")
async def connect(
    user: AuthenticatedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
    schwab_auth: SchwabAuth = Depends(get_schwab_auth),
) -> ConnectResponse:
    """Authenticated. Issues an `OAUTH_STATE` token (D4-07) and returns the
    authorize URL built from that same raw state -- `authlib` never mints
    its own state value here, which is what makes the `setup_tokens`
    consume able to validate it later."""
    raw_state = await issue_token(
        session,
        user_id=user.user_id,
        purpose=TokenPurpose.OAUTH_STATE,
        ttl=_OAUTH_STATE_TTL,
    )
    await session.commit()
    return ConnectResponse(authorize_url=schwab_auth.build_authorize_url(raw_state))


@router.get("/schwab/callback")
async def callback(
    request: Request,
    state: str,
    session: AsyncSession = Depends(get_db_session),
    schwab_auth: SchwabAuth = Depends(get_schwab_auth),
) -> CallbackResponse:
    """Unauthenticated -- the redirect arrives with no session cookie, and
    the consumed state is the only credential (CONN-02), the same posture
    `/setup` already takes.

    **Ordering is load-bearing.** `consume_token`'s own commit ends the
    transaction any earlier `set_config` would have been local to -- the
    RLS context below belongs to the transaction the write actually runs
    in, established only after that commit (mirrors `/setup`'s own
    ordering exactly).
    """
    user_id = await consume_token(
        session, raw_token=state, purpose=TokenPurpose.OAUTH_STATE
    )
    if user_id is None:
        raise HTTPException(status_code=400) from None

    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )
    await require_rls_context(session)

    exchanged_token, schwab_client = await schwab_auth.exchange_callback(
        str(request.url), raw_state=state
    )

    # D4-17, Pitfall 5 (V006): resolved once here, never re-resolved.
    # `accounts[0]` is not a documented contract -- more than one entry
    # means this phase cannot silently pick, so it fails loudly rather than
    # defaulting to index 0.
    account_entries = await schwab_client.get_account_numbers()
    if len(account_entries) != 1:
        raise HTTPException(status_code=409) from None
    account_hash = account_entries[0].hash_value

    await upsert_connection(session, user_id, exchanged_token, account_hash)
    await session.commit()
    return CallbackResponse()


@router.get("/schwab/connection")
async def connection(
    user: AuthenticatedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> ConnectionResponse:
    record = await read_connection(session, user.user_id)
    if record is None:
        raise HTTPException(status_code=404, detail="not found")
    health, expires_at = derive_connection_health(
        record.token_created_at, datetime.now(UTC)
    )
    return ConnectionResponse(
        health=health.value,
        expires_at=expires_at,
        last_synced_at=record.last_synced_at,
        reauth_notified_at=record.reauth_notified_at,
    )


@router.post("/schwab/sync")
async def sync(
    user: AuthenticatedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> SyncTriggeredResponse:
    """Defers the same `sync_user` job the scheduler defers (INGEST-04) --
    never a second write path. 404 for a user with no connection: nothing
    to sync. 429, deferring nothing, for a caller inside the configured
    cooldown.

    The cooldown is not decoration. The deployed worker runs jobs strictly
    serially at Procrastinate's default concurrency of one (`06-RESEARCH.md`),
    so an unthrottled manual trigger lets one user queue enough jobs to
    starve every other user's scheduled cycle -- a denial of service
    against the other tenants, not merely against the caller's own
    connection (T-06-17). Read off this user's own most recent `sync_runs`
    row, which this plan already records, so no new state is needed. The
    honest ceiling: this throttles by run *start* time, so it does not
    bound a caller who triggers exactly at each cooldown boundary forever
    -- accepted at this project's scale, a handful of trusted users.
    """
    record = await read_connection(session, user.user_id)
    if record is None:
        raise HTTPException(status_code=404, detail="not found")

    cooldown = timedelta(seconds=get_settings().schwab_sync_cooldown_seconds)
    recent = await read_sync_runs(session, user.user_id, limit=1)
    if recent and datetime.now(UTC) - recent[0].started_at < cooldown:
        raise HTTPException(status_code=429, detail="cooldown active")

    await defer_manual_sync(user.user_id)
    return SyncTriggeredResponse()
