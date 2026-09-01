"""Enforces D7-14: exactly two tracked modules touch each of the
`positions`/`legs` write-token sentinels -- the module that defines both
(`ledger/positions.py`) and `db/models.py`, whose `Position.__init__`/
`Leg.__init__` import the matching sentinel to check against it. The gate
lives in the constructor, so the constructor importing the sentinel is what
makes `db/models.py` the second allowed path for each sentinel, not a third
writer.

Mirrors `tests/gate/test_ingest_write_boundary.py`'s own convention wholesale
-- `git ls-files` only, never a directory walk, so an untracked scratch file
can never fail the build; this file's own source and `tests/gate/fixtures`
are excluded for the same reason that file excludes them. AST, not a line
regex: the sentinel import is deliberately multi-line (`Position.__init__`/
`Leg.__init__` import their sentinel the same cycle-breaking way
`Fill.__init__` already does), so a per-line regex would never see the
sentinel name on the same line as the `from` keyword. Parsing each file's
own AST finds both the definition (`ast.Assign`) and the import
(`ast.ImportFrom`) regardless of how either statement wraps.

Parametrized over the two sentinels rather than duplicating the module
twice: both are defined in the same module (`morai.ledger.positions`), and
both share the identical two-path allowed-importer set -- the defining
module and the one constructor file that checks against both.
"""

from __future__ import annotations

import ast
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_THIS_FILE_RELATIVE = Path(__file__).resolve().relative_to(REPO_ROOT)

_SENTINEL_MODULE = "morai.ledger.positions"
_SENTINEL_NAMES = ("_POSITION_WRITE_TOKEN", "_LEG_WRITE_TOKEN")

_ALLOWED_IMPORTERS = frozenset(
    {
        Path("src/morai/ledger/positions.py"),
        Path("src/morai/db/models.py"),
    }
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


def _references_sentinel(source: str, sentinel_name: str) -> bool:
    """`True` if `source`, parsed as Python, either defines `sentinel_name`
    (`positions.py`, its own module) or imports it via a `from
    morai.ledger.positions import ...` statement naming it among its
    imported names (`db/models.py`, regardless of how the statement wraps
    across lines). Two distinct touchpoints, not one -- the definition
    site and the one legitimate importer."""
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == sentinel_name
            for target in node.targets
        ):
            return True
        if (
            isinstance(node, ast.ImportFrom)
            and node.module == _SENTINEL_MODULE
            and any(alias.name == sentinel_name for alias in node.names)
        ):
            return True
    return False


def find_sentinel_importers(paths: list[Path], sentinel_name: str) -> list[Path]:
    """Return every path in `paths` whose source defines or imports
    `sentinel_name`."""
    offenders: list[Path] = []
    for path in paths:
        absolute_path = REPO_ROOT / path
        if _references_sentinel(absolute_path.read_text(), sentinel_name):
            offenders.append(path)
    return offenders


@pytest.mark.parametrize("sentinel_name", _SENTINEL_NAMES)
def test_only_the_write_module_and_the_model_import_the_sentinel(
    sentinel_name: str,
) -> None:
    offenders = find_sentinel_importers(_tracked_python_files(), sentinel_name)
    assert set(offenders) == _ALLOWED_IMPORTERS, (
        f"Exactly two tracked modules may import {sentinel_name} -- the "
        "write module's own path, and db/models.py, whose Position/Leg "
        "__init__ checks against it (D7-14). Found: "
        + str(sorted(str(p) for p in offenders))
    )


@pytest.mark.parametrize("sentinel_name", _SENTINEL_NAMES)
def test_scanner_reports_a_synthetic_offending_file(
    sentinel_name: str, tmp_path: Path
) -> None:
    """Proves the matcher fires -- a scanner that never rejects anything is
    decoration (same shape as `test_ingest_write_boundary.py`'s own
    negative control)."""
    offending = tmp_path / "offending.py"
    offending.write_text(f"from {_SENTINEL_MODULE} import {sentinel_name}\n")
    offenders = find_sentinel_importers([offending], sentinel_name)
    assert offenders == [offending]


@pytest.mark.parametrize("sentinel_name", _SENTINEL_NAMES)
def test_scanner_matches_the_multi_line_from_import_form_too(
    sentinel_name: str, tmp_path: Path
) -> None:
    """The real import in `db/models.py` wraps across lines -- this proves
    the AST walk catches that shape, not only a single-line import."""
    offending = tmp_path / "offending_multiline.py"
    offending.write_text(
        f"from {_SENTINEL_MODULE} import (\n    PlannedLeg,\n    {sentinel_name},\n)\n"
    )
    offenders = find_sentinel_importers([offending], sentinel_name)
    assert offenders == [offending]


@pytest.mark.parametrize("sentinel_name", _SENTINEL_NAMES)
def test_scanner_does_not_match_a_clean_file_importing_the_public_function(
    sentinel_name: str, tmp_path: Path
) -> None:
    """Negative control on the negative control: importing
    `create_positions` (the public, legitimate write path) must never be
    mistaken for importing either private sentinel -- proves the walk is
    scoped to the sentinel name, not to the module generally."""
    clean = tmp_path / "clean.py"
    clean.write_text(
        f"from {_SENTINEL_MODULE} import (\n"
        "    PlannedLeg,\n"
        "    create_positions,\n"
        ")\n"
        f"import {_SENTINEL_MODULE}\n"
    )
    assert find_sentinel_importers([clean], sentinel_name) == []


def test_scanner_excludes_its_own_source_and_the_fixtures_directory() -> None:
    files = _tracked_python_files()
    assert _THIS_FILE_RELATIVE not in files
    assert not any(f.parts[:3] == ("tests", "gate", "fixtures") for f in files)
