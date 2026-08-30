from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import SecretStr, ValidationError

from morai.settings import Settings, load_settings

RAW_DSN = "postgresql://user:sekret-password@host:5432/db"


def _clear_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)


def test_database_url_is_secret_str(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("DATABASE_URL", RAW_DSN)
    settings = Settings.model_validate({})
    assert isinstance(settings.database_url, SecretStr)


def test_password_never_appears_in_repr_or_str(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("DATABASE_URL", RAW_DSN)
    settings = Settings.model_validate({})
    assert "sekret-password" not in repr(settings)
    assert "sekret-password" not in str(settings.database_url)


def test_missing_database_url_raises_and_names_field(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_env(monkeypatch)
    with pytest.raises(ValidationError) as exc_info:
        Settings.model_validate({})
    assert "database_url" in str(exc_info.value)


def test_unknown_extra_env_key_raises(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # extra="forbid" only sees keys pulled by a *bounded* source. The OS environment is
    # unbounded (PATH, HOME, ...), so pydantic-settings' env source only ever pulls
    # declared field names from it — an arbitrary OS env var can never trip
    # extra="forbid". A `.env` file is the bounded, developer-authored source this
    # guard actually protects (a typo'd key there should fail loudly). chdir into a
    # tmp dir holding that `.env` so Settings' configured `env_file=".env"` finds it.
    _clear_env(monkeypatch)
    env_file = tmp_path / ".env"
    env_file.write_text(f"DATABASE_URL={RAW_DSN}\nSOME_UNKNOWN_KEY=value\n")
    monkeypatch.chdir(tmp_path)
    with pytest.raises(ValidationError):
        Settings.model_validate({})


def test_async_dsn_swaps_scheme(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("DATABASE_URL", RAW_DSN)
    settings = Settings.model_validate({})
    assert (
        settings.async_dsn == "postgresql+asyncpg://user:sekret-password@host:5432/db"
    )


def test_sync_dsn_swaps_scheme(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("DATABASE_URL", RAW_DSN)
    settings = Settings.model_validate({})
    assert settings.sync_dsn == "postgresql://user:sekret-password@host:5432/db"


def test_boot_failure_never_echoes_the_rejected_value(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """NN-34: a rejected key is often a credential, so the boot error names fields and
    withholds values.

    pydantic's own ValidationError renders each rejected key together with its
    `input_value`. Against a real `.env` that means the error text *is* the secret, on
    its way to stderr and from there into the platform log. `load_settings` converts
    that into a RuntimeError carrying field names and failure types only.
    """
    _clear_env(monkeypatch)
    secret = "cAnAryToKeN-must-never-be-printed"
    env_file = tmp_path / ".env"
    env_file.write_text(f"DATABASE_URL={RAW_DSN}\nSCHWAB_TRADER_APP_SECRET={secret}\n")
    monkeypatch.chdir(tmp_path)

    with pytest.raises(RuntimeError) as exc_info:
        load_settings()

    message = str(exc_info.value)
    # The offending field is named, so the operator knows what to fix...
    assert "schwab_trader_app_secret" in message
    # ...but its value never appears, and neither does the DSN password.
    assert secret not in message
    assert "sekret-password" not in message
    # Nothing carrying the value may remain reachable on the exception. `from None`
    # alone is not enough -- it sets __suppress_context__ but leaves __context__
    # attached, and a logger that walks the chain would still emit the secret.
    assert exc_info.value.__cause__ is None
    assert exc_info.value.__context__ is None
    assert secret not in repr(exc_info.value)
