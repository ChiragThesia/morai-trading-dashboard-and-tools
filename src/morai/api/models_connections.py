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
