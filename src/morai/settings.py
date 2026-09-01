from __future__ import annotations

import base64
import binascii
import os
from dataclasses import dataclass
from functools import lru_cache

from pydantic import SecretStr, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine.url import make_url


@dataclass(frozen=True)
class SchwabCredentials:
    """The three Schwab developer-app values, unwrapped once at the one call
    site that needs them (`vendor/schwab_adapter.py`) -- never crosses an
    API boundary, so a plain frozen dataclass, not an `ApiModel`."""

    api_key: str
    app_secret: str
    callback_url: str


class Settings(BaseSettings):
    """Process configuration. Built once at process boot via `get_settings()`, so a
    missing or malformed variable kills the process and names the field, instead of
    surfacing as a 500 on the first request that needs it (D-15)."""

    model_config = SettingsConfigDict(
        extra="forbid",
        # `.env` in normal operation. Tests set MORAI_ENV_FILE="" so an import-time
        # `get_settings()` reads the environment only and never picks up whatever the
        # developer happens to have in `.env` -- on this machine, v1-era keys this
        # backend does not declare, which `extra="forbid"` then rejects.
        env_file=os.environ.get("MORAI_ENV_FILE", ".env") or None,
        case_sensitive=False,
    )

    database_url: SecretStr

    # One secret, not a second full DSN (phase 2). `app_async_dsn` composes the
    # web process's runtime DSN from `database_url`'s already-correct host and
    # database plus this password and the fixed `morai_app` role -- a second
    # full `APP_DATABASE_URL` would duplicate the host/database in a place that
    # can drift out of agreement with `database_url`. Optional on the model,
    # not on `app_async_dsn`'s consumers: the worker process never reads it, and
    # a required field would kill the worker's boot over a variable it never
    # touches.
    morai_app_db_password: SecretStr | None = None

    # Telemetry. Optional by design: with no key, `morai.telemetry` is a no-op, so
    # local development, CI and a fresh clone need no PostHog account. Set
    # POSTHOG_API_KEY as a Railway variable in production -- never in a committed file,
    # because this repository is public.
    posthog_api_key: SecretStr | None = None
    posthog_host: str = "https://us.i.posthog.com"

    # The KEK (D3-06), base64-encoded in the environment. Optional on the
    # model for the same reason `morai_app_db_password` is: Alembic and the
    # worker never unwrap a user's data key and must not die over a
    # variable they never touch.
    morai_master_key: SecretStr | None = None

    # Phase 4: the Schwab developer app's own credentials. Optional on the
    # model for the same reason `morai_master_key` is -- Alembic and the
    # worker never touch these and must not die over a variable they never
    # read. `.env` holds v1-era Schwab credentials this plan's own tests
    # never touch (D4-14, every vendor interaction runs against the
    # `Protocol` fake) -- these fields exist so a real deploy can set them,
    # not so this phase's test suite reads them.
    schwab_api_key: SecretStr | None = None
    schwab_app_secret: SecretStr | None = None
    schwab_callback_url: str | None = None

    # Phase 6, D6-03: neither of the next two is verified against Schwab's
    # real API -- the first live run is the experiment that measures them.
    # 365 and 90 came forward from v1 marked UNJUSTIFIED in
    # salvage/measured-constants.md; the installed schwab-py 1.5.1 source
    # defaults `get_transactions` to a 60-day lookback with a docstring
    # claiming a 60-day range constraint, which is why the chunk width below
    # lands at 60 rather than v1's 90.
    schwab_tx_lookback_max_days: int = 365
    schwab_tx_max_range_days: int = 60
    # Chosen, not measured -- safe only because re-reading a window is free
    # once insert_fills/insert_broker_transactions carry ON CONFLICT DO
    # NOTHING on their full primary keys.
    schwab_tx_sync_overlap_days: int = 1

    @property
    def schwab_credentials(self) -> SchwabCredentials:
        """Raises before composing anything if any of the three is unset,
        naming only the missing field names -- following
        `app_async_dsn`/`master_key_bytes`'s own precedent exactly: the
        raise sits outside any `except`, so no original exception carrying a
        value stays attached as `__context__` for a chain-walking logger to
        find (`NN-34`)."""
        api_key = self.schwab_api_key
        app_secret = self.schwab_app_secret
        callback_url = self.schwab_callback_url
        missing: list[str] = []
        if api_key is None:
            missing.append("schwab_api_key")
        if app_secret is None:
            missing.append("schwab_app_secret")
        if callback_url is None:
            missing.append("schwab_callback_url")
        if api_key is None or app_secret is None or callback_url is None:
            raise RuntimeError(
                "Configuration rejected. The following Schwab credential "
                "fields are required and are withheld deliberately even "
                "when present -- values are never rendered (NN-34): "
                + ", ".join(missing)
            )
        return SchwabCredentials(
            api_key=api_key.get_secret_value(),
            app_secret=app_secret.get_secret_value(),
            callback_url=callback_url,
        )

    @property
    def async_dsn(self) -> str:
        return self.database_url.get_secret_value().replace(
            "postgresql://", "postgresql+asyncpg://", 1
        )

    @property
    def sync_dsn(self) -> str:
        return self.database_url.get_secret_value()

    @property
    def app_async_dsn(self) -> str:
        """The web process's runtime DSN: `database_url`'s own host, port and
        database, with the role and password swapped to the least-privilege
        `morai_app` role (phase 2's RLS design -- see alembic/versions/0003).

        Raises before composing anything if the password is unset, naming only
        the field. Following `load_settings`'s precedent exactly: the `raise`
        sits outside any `except`, so no original exception carrying a value
        stays attached as `__context__` for a chain-walking logger to find
        (`NN-34`).
        """
        password = self.morai_app_db_password
        if password is None:
            raise RuntimeError(
                "Configuration rejected. `morai_app_db_password` is required to "
                "build the web process's database connection, and is withheld "
                "deliberately even when present -- values are never rendered "
                "(NN-34)."
            )
        url = make_url(self.database_url.get_secret_value()).set(
            drivername="postgresql+asyncpg",
            username="morai_app",
            password=password.get_secret_value(),
        )
        return url.render_as_string(hide_password=False)

    @property
    def master_key_bytes(self) -> bytes:
        """The KEK, base64-decoded to exactly 32 bytes for AES-256-GCM
        (D3-06, CRYPT-01).

        Raises before decoding anything is used if the value is unset, not
        valid base64, or does not decode to exactly 32 bytes -- naming only
        the field, following `app_async_dsn`'s own precedent: the raise
        sits outside any `except`, so no original exception carrying the
        value stays attached as `__context__` (NN-34).
        """
        key = self.morai_master_key
        if key is None:
            raise RuntimeError(
                "Configuration rejected. `morai_master_key` is required to "
                "unwrap any user's data key, and is withheld deliberately "
                "even when present -- values are never rendered (NN-34)."
            )
        decoded: bytes | None
        try:
            decoded = base64.b64decode(key.get_secret_value(), validate=True)
        except (binascii.Error, ValueError):
            decoded = None
        if decoded is None or len(decoded) != 32:
            raise RuntimeError(
                "Configuration rejected. `morai_master_key` must be base64 "
                "of exactly 32 bytes for AES-256-GCM; its value is withheld "
                "deliberately (NN-34)."
            )
        return decoded


def load_settings() -> Settings:
    """Build `Settings`, converting any failure into an error that names fields and
    withholds values.

    `extra="forbid"` reports every rejected key, and pydantic's own `ValidationError`
    renders each one with its `input_value` attached. When the rejected key is a
    credential — which is exactly the case a `.env` file produces — that error text is
    the credential, in plaintext, on its way to stderr and from there into the platform
    log. `NN-34` forbids that: an OAuth code, an app secret or a DSN password is
    bearer-equivalent and is never rendered, never logged, never echoed in an error.

    So the `ValidationError` is caught and replaced with a `RuntimeError` carrying only
    field names and failure types.

    The `raise` sits *outside* the `except` block on purpose, and that placement is
    load-bearing. Raising inside it — even with `from None` — leaves the original
    `ValidationError` attached as `__context__`. `from None` only sets
    `__suppress_context__`, which stops the default traceback printer from rendering
    the chain; it does not detach it. Any logger that walks `__context__` to capture a
    full exception chain, which structured loggers routinely do, would still emit the
    secret. Raising after the block leaves nothing attached to walk.

    D-15 is preserved exactly — a missing or malformed variable still kills boot and
    still names the offending field. It just no longer quotes it.
    """
    offenders: list[str] = []
    try:
        # `Settings()` (the synthesized-`__init__` constructor) types every field as a
        # required argument, since neither checker can know pydantic-settings populates
        # them from the environment at runtime. `model_validate({})` runs the identical
        # settings-source merge but is typed `Self`, so nothing needs suppressing.
        return Settings.model_validate({})
    except ValidationError as exc:
        offenders = sorted(
            "{}: {}".format(".".join(str(part) for part in err["loc"]), err["type"])
            for err in exc.errors(include_url=False, include_input=False)
        )

    raise RuntimeError(
        "Configuration rejected. Field names and failure types follow; values are "
        "withheld deliberately, because a rejected key is often a credential "
        "(NN-34).\n  " + "\n  ".join(offenders)
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """The process-wide `Settings`, built once on first call.

    Deliberately not a module-level singleton. `settings = load_settings()` at module
    scope fails at *import* time, which is not the same thing as boot: it fires during
    test collection, during any tooling that merely imports the package, and before a
    fixture can isolate the environment. That is how the first version of this suite
    reported green — it ran in a git worktree with no `.env`, and failed the moment it
    ran from the primary checkout.

    D-15 is unchanged in substance: a missing or malformed variable still kills the
    process and still names the field, rather than surfacing as a 500 on the first
    request that needs it. It now does so when the process actually boots — the ASGI
    lifespan, the worker entrypoint, an Alembic run — which is what "read at startup"
    meant. The cache makes every later call free.
    """
    return load_settings()
