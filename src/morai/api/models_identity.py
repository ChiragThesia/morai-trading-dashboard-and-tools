"""Request and response models for the admin-driven account lifecycle
(D2-01, D2-02, `NN-34`). Every model derives from `ApiModel` (D-09, D-12).

The one-time-token field on each admin response is named `setup_token` /
`reset_token`, never `token` or `id` -- so it reads as a secret at the call
site, not as an identifier a caller might casually log or pass around.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import Field

from morai.api.models import ApiModel


class AdminCreateUserRequest(ApiModel):
    username: str


class AdminCreateUserResponse(ApiModel):
    user_id: UUID
    setup_token: str


class AdminResetPasswordResponse(ApiModel):
    reset_token: str


class SetupRequest(ApiModel):
    token: str
    # These accounts are linked to brokerage credentials -- the same reasoning
    # `passwords.py`'s docstring uses to justify the higher Argon2id band
    # (D2-03). Hashing strength is moot against a trivially guessable input.
    password: str = Field(min_length=12)


class SetupResponse(ApiModel):
    """Deliberately empty. A successful setup must not confirm which account
    it belonged to -- no user id, no username, nothing beyond the 200
    itself."""


class LoginRequest(ApiModel):
    username: str
    password: str


class LoginResponse(ApiModel):
    """Deliberately empty -- same reasoning as `SetupResponse`. The session
    cookie is the only credential a client needs; `/me` is where a client
    asks who it is, and a login response that names the account is one more
    place a token-adjacent value can end up in a log."""
