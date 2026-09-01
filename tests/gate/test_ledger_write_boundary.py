"""Enforces D7-14: exactly two tracked modules touch each of the
`positions`/`legs`/`events` write-token sentinels -- the module that
defines the sentinel (`ledger/positions.py` for `_POSITION_WRITE_TOKEN`/
`_LEG_WRITE_TOKEN`, `ledger/events.py` for `_EVENT_WRITE_TOKEN`) and
`db/models.py`, whose `Position.__init__`/`Leg.__init__`/`Event.__init__`
import the matching sentinel to check against it. The gate lives in the
constructor, so the constructor importing the sentinel is what makes
`db/models.py` the second allowed path for each sentinel, not a third
writer.

Mirrors `tests/gate/test_ingest_write_boundary.py`'s own convention
wholesale -- `git ls-files` only, never a directory walk, so an untracked
scratch file can never fail the build; this file's own source and
`tests/gate/fixtures` are excluded for the same reason that file excludes
them. AST, not a line regex: the sentinel import is deliberately
multi-line (each `__init__` imports its sentinel the same cycle-breaking
way `Fill.__init__` already does), so a per-line regex would never see the
sentinel name on the same line as the `from` keyword. Parsing each file's
own AST finds both the definition (`ast.Assign`) and the import
(`ast.ImportFrom`) regardless of how either statement wraps.

Parametrized over `_SENTINELS`, one entry per (module, name,
allowed-importers) triple -- `_POSITION_WRITE_TOKEN`/`_LEG_WRITE_TOKEN`
share a module and an allowed-importer set; `_EVENT_WRITE_TOKEN` (07-02
Task 4, migration 0014's ROLL/SETTLEMENT writers making a second `events`
writer a real temptation for the first time, per 03-RESEARCH.md's Open
Question 2) is defined in `morai.ledger.events` instead and carries its
own, different allowed-importer pair -- a single shared allowed-importer
set across all three names would either wrongly permit `events.py` to
import the position/leg sentinels or wrongly demand `positions.py` import
the event sentinel, so each sentinel is checked against its own pair, not
a codebase-wide union.
"""

from __future__ import annotations

import ast
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_THIS_FILE_RELATIVE = Path(__file__).resolve().relative_to(REPO_ROOT)

_POSITIONS_MODULE = "morai.ledger.positions"
_EVENTS_MODULE = "morai.ledger.events"

_POSITION_LEG_IMPORTERS = frozenset(
    {
        Path("src/morai/ledger/positions.py"),
        Path("src/morai/db/models.py"),
    }
)
_EVENT_IMPORTERS = frozenset(
    {
        Path("src/morai/ledger/events.py"),
        Path("src/morai/db/models.py"),
    }
)

# (sentinel_module, sentinel_name, allowed_importers) -- one entry per
# sentinel this gate covers.
_SENTINELS: tuple[tuple[str, str, frozenset[Path]], ...] = (
    (_POSITIONS_MODULE, "_POSITION_WRITE_TOKEN", _POSITION_LEG_IMPORTERS),
    (_POSITIONS_MODULE, "_LEG_WRITE_TOKEN", _POSITION_LEG_IMPORTERS),
    (_EVENTS_MODULE, "_EVENT_WRITE_TOKEN", _EVENT_IMPORTERS),
)


def _tracked_python_files() -> list[Path]:
    """Every tracked `.py` file under `src/` and `tests/`, excluding the
    fixtures directory (deliberate violations, D-07) and this file's own
    path -- identical convention to `test_ingest_write_boundary.py`."""
    result = subprocess.run(
        ["git", "ls-files", "--", "src", "tests"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    files: list[Path] = []
    for line in result.stdout.splitlines():
        if not line.endswith(".py"):
            continue
        path = Path(line)
        if path.parts[:3] == ("tests", "gate", "fixtures"):
            continue
        if path == _THIS_FILE_RELATIVE:
            continue
        files.append(path)
    return files


def _references_sentinel(source: str, sentinel_module: str, sentinel_name: str) -> bool:
    """`True` if `source`, parsed as Python, either defines `sentinel_name`
    (the sentinel's own defining module) or imports it via a `from
    {sentinel_module} import ...` statement naming it among its imported
    names (`db/models.py`, regardless of how the statement wraps across
    lines). Two distinct touchpoints, not one -- the definition site and
    the one legitimate importer."""
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == sentinel_name
            for target in node.targets
        ):
            return True
        if (
            isinstance(node, ast.ImportFrom)
            and node.module == sentinel_module
            and any(alias.name == sentinel_name for alias in node.names)
        ):
            return True
    return False


def find_sentinel_importers(
    paths: list[Path], sentinel_module: str, sentinel_name: str
) -> list[Path]:
    """Return every path in `paths` whose source defines or imports
    `sentinel_name` from `sentinel_module`."""
    offenders: list[Path] = []
    for path in paths:
        absolute_path = REPO_ROOT / path
        if _references_sentinel(
            absolute_path.read_text(), sentinel_module, sentinel_name
        ):
            offenders.append(path)
    return offenders


@pytest.mark.parametrize(("sentinel_module", "sentinel_name", "allowed"), _SENTINELS)
def test_only_the_write_module_and_the_model_import_the_sentinel(
    sentinel_module: str, sentinel_name: str, allowed: frozenset[Path]
) -> None:
    offenders = find_sentinel_importers(
        _tracked_python_files(), sentinel_module, sentinel_name
    )
    assert set(offenders) == allowed, (
        f"Exactly two tracked modules may import {sentinel_name} -- the "
        "write module's own path, and db/models.py, whose constructor "
        "checks against it (D7-14). Found: " + str(sorted(str(p) for p in offenders))
    )


@pytest.mark.parametrize(("sentinel_module", "sentinel_name", "allowed"), _SENTINELS)
def test_scanner_reports_a_synthetic_offending_file(
    sentinel_module: str,
    sentinel_name: str,
    allowed: frozenset[Path],
    tmp_path: Path,
) -> None:
    """Proves the matcher fires -- a scanner that never rejects anything is
    decoration (same shape as `test_ingest_write_boundary.py`'s own
    negative control)."""
    offending = tmp_path / "offending.py"
    offending.write_text(f"from {sentinel_module} import {sentinel_name}\n")
    offenders = find_sentinel_importers([offending], sentinel_module, sentinel_name)
    assert offenders == [offending]


@pytest.mark.parametrize(("sentinel_module", "sentinel_name", "allowed"), _SENTINELS)
def test_scanner_matches_the_multi_line_from_import_form_too(
    sentinel_module: str,
    sentinel_name: str,
    allowed: frozenset[Path],
    tmp_path: Path,
) -> None:
    """The real import in `db/models.py` wraps across lines -- this proves
    the AST walk catches that shape, not only a single-line import."""
    offending = tmp_path / "offending_multiline.py"
    offending.write_text(
        f"from {sentinel_module} import (\n    x,\n    {sentinel_name},\n)\n"
    )
    offenders = find_sentinel_importers([offending], sentinel_module, sentinel_name)
    assert offenders == [offending]


@pytest.mark.parametrize(("sentinel_module", "sentinel_name", "allowed"), _SENTINELS)
def test_scanner_does_not_match_a_clean_file_importing_the_public_function(
    sentinel_module: str,
    sentinel_name: str,
    allowed: frozenset[Path],
    tmp_path: Path,
) -> None:
    """Negative control on the negative control: importing a public,
    legitimate name (never the sentinel) must never be mistaken for
    importing the sentinel -- proves the walk is scoped to the sentinel
    name, not to the module generally."""
    clean = tmp_path / "clean.py"
    clean.write_text(
        f"from {sentinel_module} import (\n"
        "    something_public,\n"
        ")\n"
        f"import {sentinel_module}\n"
    )
    assert find_sentinel_importers([clean], sentinel_module, sentinel_name) == []


def test_scanner_excludes_its_own_source_and_the_fixtures_directory() -> None:
    files = _tracked_python_files()
    assert _THIS_FILE_RELATIVE not in files
    assert not any(f.parts[:3] == ("tests", "gate", "fixtures") for f in files)
