"""Enforces D6-02: exactly two tracked modules touch the
`broker_transactions` write-token sentinel -- the module that defines it
(`ingest/broker_transactions.py`) and `db/models.py`, whose
`BrokerTransaction.__init__` imports it to check against it.

Mirrors `tests/gate/test_vendor_boundary.py`'s own convention: `git
ls-files` only, never a directory walk, so an untracked scratch file can
never fail the build; this file's own source and `tests/gate/fixtures` are
excluded for the same reason that file excludes them -- a scanner that
flags its own source (or the fixture files D-07 deliberately keeps
non-compliant) is not trustworthy.

**AST, not a line regex, unlike `test_vendor_boundary.py`'s own
`_VENDOR_IMPORT`.** The sentinel import is deliberately multi-line --
`BrokerTransaction.__init__` imports it the same cycle-breaking way
`Fill.__init__` already does, `from morai.ingest.broker_transactions
import (\\n    _BROKER_TRANSACTION_WRITE_TOKEN,\\n)` -- so a per-line
regex would never see the sentinel name on the same line as the `from`
keyword. Parsing each file's own AST finds both the definition
(`ast.Assign`) and the import (`ast.ImportFrom`) regardless of how either
statement wraps, the same AST-over-text discipline
`tests/ingest/test_extract_fills.py`'s own no-`abs()` gate already uses.

Two paths are allowed, not one: `src/morai/ingest/broker_transactions.py`
(where the sentinel is defined -- it does not import itself, so a
plain import-only scan would never see it, hence scanning for the
definition too) and `src/morai/db/models.py` (the constructor that
imports it to check against it). The gate lives in the constructor, so
the constructor importing it is what makes the model file the second
allowed path, not a third writer.
"""

from __future__ import annotations

import ast
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_THIS_FILE_RELATIVE = Path(__file__).resolve().relative_to(REPO_ROOT)

_SENTINEL_MODULE = "morai.ingest.broker_transactions"
_SENTINEL_NAME = "_BROKER_TRANSACTION_WRITE_TOKEN"

_ALLOWED_IMPORTERS = frozenset(
    {
        Path("src/morai/ingest/broker_transactions.py"),
        Path("src/morai/db/models.py"),
    }
)


def _tracked_python_files() -> list[Path]:
    """Every tracked `.py` file under `src/` and `tests/`, excluding the
    fixtures directory (deliberate violations, D-07) and this file's own
    path -- identical convention to `test_vendor_boundary.py`."""
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


def _references_sentinel(source: str) -> bool:
    """`True` if `source`, parsed as Python, either defines the sentinel
    (`_BROKER_TRANSACTION_WRITE_TOKEN = ...`, its own module,
    `broker_transactions.py`) or imports it via a `from
    morai.ingest.broker_transactions import ...` statement naming it among
    its imported names (`db/models.py`, regardless of how the statement
    wraps across lines). Two distinct touchpoints, not one -- the
    definition site and the one legitimate importer."""
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == _SENTINEL_NAME
            for target in node.targets
        ):
            return True
        if (
            isinstance(node, ast.ImportFrom)
            and node.module == _SENTINEL_MODULE
            and any(alias.name == _SENTINEL_NAME for alias in node.names)
        ):
            return True
    return False


def find_sentinel_importers(paths: list[Path]) -> list[Path]:
    """Return every path in `paths` whose source defines or imports the
    sentinel."""
    offenders: list[Path] = []
    for path in paths:
        absolute_path = REPO_ROOT / path
        if _references_sentinel(absolute_path.read_text()):
            offenders.append(path)
    return offenders


def test_only_the_write_module_and_the_model_import_the_sentinel() -> None:
    offenders = find_sentinel_importers(_tracked_python_files())
    assert set(offenders) == _ALLOWED_IMPORTERS, (
        f"Exactly two tracked modules may import {_SENTINEL_NAME} -- the "
        "write module's own path, and db/models.py, whose "
        "BrokerTransaction.__init__ checks against it (D6-02). Found: "
        + str(sorted(str(p) for p in offenders))
    )


def test_scanner_reports_a_synthetic_offending_file(tmp_path: Path) -> None:
    """Proves the matcher fires -- a scanner that never rejects anything is
    decoration (same shape as `test_vendor_boundary.py`'s own negative
    control)."""
    offending = tmp_path / "offending.py"
    offending.write_text(f"from {_SENTINEL_MODULE} import {_SENTINEL_NAME}\n")
    offenders = find_sentinel_importers([offending])
    assert offenders == [offending]


def test_scanner_matches_the_multi_line_from_import_form_too(
    tmp_path: Path,
) -> None:
    """The real import in `db/models.py` wraps across lines -- this proves
    the AST walk catches that shape, not only a single-line import."""
    offending = tmp_path / "offending_multiline.py"
    offending.write_text(
        f"from {_SENTINEL_MODULE} import (\n"
        "    BrokerTransactionWrite,\n"
        f"    {_SENTINEL_NAME},\n"
        ")\n"
    )
    offenders = find_sentinel_importers([offending])
    assert offenders == [offending]


def test_scanner_does_not_match_a_clean_file_importing_the_public_function(
    tmp_path: Path,
) -> None:
    """Negative control on the negative control: importing
    `insert_broker_transactions` (the public, legitimate write path) must
    never be mistaken for importing the private sentinel -- proves the
    walk is scoped to the sentinel name, not to the module generally."""
    clean = tmp_path / "clean.py"
    clean.write_text(
        f"from {_SENTINEL_MODULE} import (\n"
        "    BrokerTransactionWrite,\n"
        "    insert_broker_transactions,\n"
        ")\n"
        f"import {_SENTINEL_MODULE}\n"
    )
    assert find_sentinel_importers([clean]) == []


def test_scanner_excludes_its_own_source_and_the_fixtures_directory() -> None:
    files = _tracked_python_files()
    assert _THIS_FILE_RELATIVE not in files
    assert not any(f.parts[:3] == ("tests", "gate", "fixtures") for f in files)
