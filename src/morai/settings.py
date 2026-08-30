from __future__ import annotations

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Process configuration. Instantiated once at import (see `settings` below) so a
    missing or malformed variable kills boot and names the field, instead of surfacing
    as a 500 on the first request that needs it (D-15)."""

    model_config = SettingsConfigDict(
        extra="forbid", env_file=".env", case_sensitive=False
    )

    database_url: SecretStr

    @property
    def async_dsn(self) -> str:
        return self.database_url.get_secret_value().replace(
            "postgresql://", "postgresql+asyncpg://", 1
        )

    @property
    def sync_dsn(self) -> str:
        return self.database_url.get_secret_value()


# `Settings()` (the synthesized-`__init__` constructor) types every field as a required
# positional/keyword argument, since basedpyright and mypy have no way to know
# pydantic-settings populates missing fields from the environment at runtime.
# `model_validate({})` runs through the same settings-sources merge but is typed with
# a plain `Self` return, so no field-presence mismatch exists to suppress.
settings = Settings.model_validate({})
