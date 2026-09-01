"""Request and response models for the Schwab connection routes
(CONN-01, CONN-04, CONN-07). Every model derives from `ApiModel` (D-09,
D-12), matching `api/models_identity.py`.
"""

from __future__ import annotations

from datetime import datetime

from morai.api.models import ApiModel


class ConnectResponse(ApiModel):
    authorize_url: str


class CallbackResponse(ApiModel):
    """Deliberately near-empty -- `NN-34` discipline applies to this route
    above all others in the codebase: the received URL, the code and the
    state are bearer-equivalent, and none of the three has any business
    appearing in a response body."""


class ConnectionResponse(ApiModel):
    health: str
    expires_at: datetime
    last_synced_at: datetime | None
    reauth_notified_at: datetime | None


class SyncTriggeredResponse(ApiModel):
    """Deliberately near-empty, matching `CallbackResponse`'s own
    discipline (task 2, `NN-34`) -- no job id, no window, no vendor
    detail. Success is the only thing this response body communicates."""


class SyncRunResponse(ApiModel):
    """One sync run (task 3, `GET /schwab/sync-runs`). The two landed
    counts and `error_code` are `Optional`, load-bearing rather than
    defensive -- a failed run's counts are unknown, and serialising them
    as `0` would report a broken cycle as an empty one, the same `NN-16`
    failure task 1 already refused at the column."""

    started_at: datetime
    finished_at: datetime
    trigger: str
    status: str
    fills_landed: int | None
    broker_transactions_landed: int | None
    error_code: str | None
