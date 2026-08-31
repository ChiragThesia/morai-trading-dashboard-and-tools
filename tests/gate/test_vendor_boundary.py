"""Enforces D4-02: exactly one tracked module imports the vendor package
`schwab`, and it is `src/morai/vendor/schwab_adapter.py`.

Mirrors `tests/gate/test_suppressions.py`'s own convention exactly: `git
ls-files` only, never a directory walk, so an untracked scratch file can
never fail the build; this file's own source and `tests/gate/fixtures` are
excluded for the same reason that file excludes them -- a scanner that
flags its own source (or the fixture files D-07 deliberately keeps
non-compliant) is not trustworthy.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_THIS_FILE_RELATIVE = Path(__file__).resolve().relative_to(REPO_ROOT)

# Matches `import schwab`, `import schwab.auth`, `from schwab import ...`,
# and `from schwab.client import ...` -- both the plain-module and
# from-import forms D4-02 forbids everywhere but the one adapter module.
# `\b` after the module name stops this from matching `schwab_adapter` --
# `_` is a word character, so there is no boundary between `schwab` and
# `_adapter`, and the pattern never fires on our own package's name.
_VENDOR_IMPORT = re.compile(
    r"^\s*(?:import\s+schwab(?:\.\S+)?\b|from\s+schwab(?:\.\S+)?\s+import\b)"
)

_ALLOWED_IMPORTER = Path("src/morai/vendor/schwab_adapter.py")


def _tracked_python_files() -> list[Path]:
    """Every tracked `.py` file under `src/` and `tests/`, excluding the
    fixtures directory (deliberate violations, D-07) and this file's own
    path -- identical convention to `test_suppressions.py`."""
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


def find_vendor_importers(paths: list[Path]) -> list[Path]:
    """Return every path in `paths` containing a line that imports the
    vendor package `schwab`."""
    offenders: list[Path] = []
    for path in paths:
        absolute_path = REPO_ROOT / path
        contents = absolute_path.read_text()
        for line in contents.splitlines():
            if _VENDOR_IMPORT.match(line):
                offenders.append(path)
                break
    return offenders


def test_only_the_adapter_module_imports_the_vendor_package() -> None:
    offenders = find_vendor_importers(_tracked_python_files())
    assert offenders == [_ALLOWED_IMPORTER], (
        "Exactly one tracked module may import `schwab` -- "
        f"{_ALLOWED_IMPORTER} (D4-02). Found: {sorted(str(p) for p in offenders)}"
    )


def test_scanner_reports_a_synthetic_offending_file(tmp_path: Path) -> None:
    """Proves the matcher fires -- a scanner that never rejects anything is
    decoration (same shape as `test_suppressions.py`'s own negative
    control)."""
    offending = tmp_path / "offending.py"
    offending.write_text("import schwab.client\n")
    offenders = find_vendor_importers([offending])
    assert offenders == [offending]


def test_scanner_matches_the_from_import_form_too(tmp_path: Path) -> None:
    offending = tmp_path / "offending_from.py"
    offending.write_text("from schwab.auth import get_auth_context\n")
    offenders = find_vendor_importers([offending])
    assert offenders == [offending]


def test_scanner_does_not_match_this_projects_own_adapter_module_name(
    tmp_path: Path,
) -> None:
    """Negative control on the negative control: `schwab_adapter` (this
    project's own module) must never be mistaken for `schwab` (the vendor
    package) -- proves the `\\b` boundary in `_VENDOR_IMPORT` is load-bearing,
    not decorative."""
    clean = tmp_path / "clean.py"
    clean.write_text(
        "from morai.vendor.schwab_adapter import SchwabAuthAdapter\n"
        "import morai.vendor.schwab_adapter\n"
    )
    assert find_vendor_importers([clean]) == []


def test_scanner_excludes_its_own_source_and_the_fixtures_directory() -> None:
    files = _tracked_python_files()
    assert _THIS_FILE_RELATIVE not in files
    assert not any(f.parts[:3] == ("tests", "gate", "fixtures") for f in files)
