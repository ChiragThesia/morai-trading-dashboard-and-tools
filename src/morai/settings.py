from __future__ import annotations

import os
from functools import lru_cache

from pydantic import SecretStr, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict


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

    # Telemetry. Optional by design: with no key, `morai.telemetry` is a no-op, so
    # local development, CI and a fresh clone need no PostHog account. Set
    # POSTHOG_API_KEY as a Railway variable in production -- never in a committed file,
    # because this repository is public.
    posthog_api_key: SecretStr | None = None
    posthog_host: str = "https://us.i.posthog.com"

    @property
    def async_dsn(self) -> str:
        return self.database_url.get_secret_value().replace(
            "postgresql://", "postgresql+asyncpg://", 1
        )

    @property
    def sync_dsn(self) -> str:
        return self.database_url.get_secret_value()


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
