from __future__ import annotations

import base64
from pathlib import Path

import pytest
from pydantic import SecretStr, ValidationError

from morai.settings import Settings, get_settings, load_settings

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
    # The session sets MORAI_ENV_FILE="" so import-time loads ignore the developer's
    # real `.env`. That resolves into `model_config` when the class is defined, so a
    # test wanting its own env file has to override the resolved entry. Without this
    # the model reads no file at all and this test would still raise -- on a *missing*
    # database_url, not on the extra key it exists to catch. Passing for the wrong
    # reason is worse than failing.
    monkeypatch.setitem(Settings.model_config, "env_file", str(env_file))
    with pytest.raises(ValidationError) as exc_info:
        Settings.model_validate({})
    assert "some_unknown_key" in str(exc_info.value).lower()


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


def test_app_async_dsn_preserves_host_and_replaces_role(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`app_async_dsn` composes from `database_url`'s own host/port/database --
    only the username and password change, and only via `make_url(...).set(...)`,
    never string surgery."""
    _clear_env(monkeypatch)
    monkeypatch.setenv("DATABASE_URL", RAW_DSN)
    monkeypatch.setenv("MORAI_APP_DB_PASSWORD", "app-role-secret")
    settings = Settings.model_validate({})
    assert (
        settings.app_async_dsn
        == "postgresql+asyncpg://morai_app:app-role-secret@host:5432/db"
    )


def test_app_async_dsn_raises_when_password_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """NN-34: the message names the missing field only -- never the DSN, the
    password, or the host it would have composed from."""
    _clear_env(monkeypatch)
    monkeypatch.delenv("MORAI_APP_DB_PASSWORD", raising=False)
    monkeypatch.setenv("DATABASE_URL", RAW_DSN)
    settings = Settings.model_validate({})

    with pytest.raises(RuntimeError) as exc_info:
        _ = settings.app_async_dsn

    message = str(exc_info.value)
    assert "morai_app_db_password" in message
    assert "sekret-password" not in message
    assert "host" not in message
    # Same D-15/NN-34 shape as `load_settings`: nothing carrying a value stays
    # attached on the raised exception for a chain-walking logger to find.
    assert exc_info.value.__cause__ is None
    assert exc_info.value.__context__ is None


def test_master_key_bytes_raises_when_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    monkeypatch.delenv("MORAI_MASTER_KEY", raising=False)
    monkeypatch.setenv("DATABASE_URL", RAW_DSN)
    settings = Settings.model_validate({})

    with pytest.raises(RuntimeError) as exc_info:
        _ = settings.master_key_bytes

    message = str(exc_info.value)
    assert "morai_master_key" in message
    # Same D-15/NN-34 shape as `app_async_dsn`: nothing carrying a value
    # stays attached on the raised exception for a chain-walking logger.
    assert exc_info.value.__cause__ is None
    assert exc_info.value.__context__ is None


def test_master_key_bytes_raises_when_wrong_length(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("DATABASE_URL", RAW_DSN)
    # base64 of 16 bytes, not the required 32 -- the wrong-length case.
    short_key = base64.b64encode(b"x" * 16).decode()
    monkeypatch.setenv("MORAI_MASTER_KEY", short_key)
    settings = Settings.model_validate({})

    with pytest.raises(RuntimeError) as exc_info:
        _ = settings.master_key_bytes

    message = str(exc_info.value)
    assert "morai_master_key" in message
    assert short_key not in message
    assert exc_info.value.__cause__ is None
    assert exc_info.value.__context__ is None


def test_settings_model_fields_still_yield_exactly_one_dsn_field() -> None:
    """`morai_app_db_password` is a credential, not a DSN -- the filter this
    project's `test_settings_expose_a_single_database_url` uses must still see
    exactly one DSN-shaped field after this phase adds a second connection
    identity."""
    dsn_fields = [
        name
        for name in Settings.model_fields
        if "database" in name or "dsn" in name or "postgres" in name
    ]
    assert dsn_fields == ["database_url"]


def test_schwab_credentials_raises_and_names_all_missing_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """NN-34: the message names the missing fields only -- never a value,
    and nothing carrying a value stays attached for a chain-walking
    logger to find (same shape as `app_async_dsn`/`master_key_bytes`)."""
    _clear_env(monkeypatch)
    monkeypatch.delenv("SCHWAB_API_KEY", raising=False)
    monkeypatch.delenv("SCHWAB_APP_SECRET", raising=False)
    monkeypatch.delenv("SCHWAB_CALLBACK_URL", raising=False)
    monkeypatch.setenv("DATABASE_URL", RAW_DSN)
    settings = Settings.model_validate({})

    with pytest.raises(RuntimeError) as exc_info:
        _ = settings.schwab_credentials

    message = str(exc_info.value)
    assert "schwab_api_key" in message
    assert "schwab_app_secret" in message
    assert "schwab_callback_url" in message
    assert exc_info.value.__cause__ is None
    assert exc_info.value.__context__ is None


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
    monkeypatch.setitem(Settings.model_config, "env_file", str(env_file))
    get_settings.cache_clear()

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
