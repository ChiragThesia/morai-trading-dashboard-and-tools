"""`.railway/railway.ts` must declare every environment variable the service
it defines actually requires at runtime.

This has now failed twice, the same way both times, and neither failure was
visible from a green suite. `railway config apply` strips any variable the IaC
does not name, so an undeclared secret does not fail loudly at deploy -- it
fails later, at the first request or the first job that reaches the code path
needing it.

- Phase 4's `CR-01`: the three `SCHWAB_*` credentials were missing from the
  `web` service. Caught by code review, not by a test.
- Phase 6/8/9: `sync_user_task` and the snapshot tasks moved onto
  `get_session_maker()` (`MORAI_APP_DB_PASSWORD`), the envelope crypto path
  (`MORAI_MASTER_KEY`) and `get_schwab_auth()` (the three `SCHWAB_*`), while
  the `worker` service's own `env` block still named only `DATABASE_URL` --
  exactly what that block's own comment said to fix "at that point". Every
  scheduled sync would have raised `RuntimeError` out of
  `Settings.schwab_credentials`, been classified by `classify_sync_error`,
  recorded as a failed `sync_runs` row and re-raised -- so no user's token
  would ever be refreshed and every connection would die at seven days with
  the code itself perfectly correct.

The table below is the check. It is deliberately a declared list rather than
anything derived: the derivation ("which settings fields can this entry point
reach?") is a whole-program analysis, and a list that has to be edited when a
service's requirements change is the point, not a shortcoming.
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
RAILWAY_IAC = REPO_ROOT / ".railway" / "railway.ts"

# service name -> the variables that service's own start command reaches.
_REQUIRED_ENV: dict[str, tuple[str, ...]] = {
    # `alembic upgrade head && hypercorn morai.api.app:app`
    "web": (
        "DATABASE_URL",
        "MORAI_APP_DB_PASSWORD",  # get_app_engine, every request's session
        "MORAI_MASTER_KEY",  # envelope crypto on every encrypted read/write
        "SCHWAB_API_KEY",  # get_schwab_auth -> Settings.schwab_credentials
        "SCHWAB_APP_SECRET",
        "SCHWAB_CALLBACK_URL",
    ),
    # `procrastinate --app morai.worker.app.app worker`
    "worker": (
        "DATABASE_URL",  # the Procrastinate connector's own superuser pool
        "MORAI_APP_DB_PASSWORD",  # sync_user_task -> get_session_maker
        "MORAI_MASTER_KEY",  # read_connection / insert_fills
        "SCHWAB_API_KEY",  # worker.app.get_schwab_auth, every scheduled sync
        "SCHWAB_APP_SECRET",
        "SCHWAB_CALLBACK_URL",
    ),
}


def service_block(source: str, name: str) -> str:
    """The slice of `railway.ts` belonging to one `service("<name>", ...)`
    declaration -- from its own `service(` call to the start of the next
    top-level `const ` or the closing `return project(`."""
    start = source.index(f'service("{name}"')
    rest = source[start:]
    ends = [i for i in (rest.find("\n  const "), rest.find("\n  return ")) if i != -1]
    return rest[: min(ends)] if ends else rest


def test_every_service_declares_the_env_vars_its_code_path_requires() -> None:
    source = RAILWAY_IAC.read_text()
    missing: dict[str, list[str]] = {}
    for name, required in _REQUIRED_ENV.items():
        block = service_block(source, name)
        absent = [var for var in required if var not in block]
        if absent:
            missing[name] = absent
    assert missing == {}, (
        "`railway config apply` strips any variable the IaC does not name. "
        f"Undeclared but required at runtime: {missing}"
    )


def test_the_block_splitter_does_not_leak_one_service_into_another() -> None:
    """Negative control: a scanner that reads the whole file for every service
    passes vacuously the moment any one service declares a variable."""
    source = RAILWAY_IAC.read_text()
    worker_block = service_block(source, "worker")
    assert 'service("worker"' in worker_block
    assert "procrastinate" in worker_block
    assert "hypercorn" not in worker_block
    assert "healthcheck" not in worker_block
