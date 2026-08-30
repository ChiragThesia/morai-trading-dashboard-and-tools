from __future__ import annotations

import pytest
from pydantic import SecretStr, ValidationError

from morai.settings import Settings

RAW_DSN = "postgresql://user:sekret-password@host:5432/db"


def _clear_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)


def test_database_url_is_secret_str(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("DATABASE_URL", RAW_DSN)
    settings = Settings()
    assert isinstance(settings.database_url, SecretStr)


def test_password_never_appears_in_repr_or_str(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("DATABASE_URL", RAW_DSN)
    settings = Settings()
    assert "sekret-password" not in repr(settings)
    assert "sekret-password" not in str(settings.database_url)


def test_missing_database_url_raises_and_names_field(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    with pytest.raises(ValidationError) as exc_info:
        Settings()
    assert "database_url" in str(exc_info.value)


def test_unknown_extra_env_key_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("DATABASE_URL", RAW_DSN)
    monkeypatch.setenv("SOME_UNKNOWN_KEY", "value")
    with pytest.raises(ValidationError):
        Settings()


def test_async_dsn_swaps_scheme(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("DATABASE_URL", RAW_DSN)
    settings = Settings()
    assert settings.async_dsn == "postgresql+asyncpg://user:sekret-password@host:5432/db"


def test_sync_dsn_swaps_scheme(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("DATABASE_URL", RAW_DSN)
    settings = Settings()
    assert settings.sync_dsn == "postgresql://user:sekret-password@host:5432/db"
