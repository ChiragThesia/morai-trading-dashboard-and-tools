"""Enforces D-06: a rule-coded suppression must also carry a written reason.

ruff's `PGH003` (see `pyproject.toml`) already forces every `# type: ignore` comment
to name a rule code. Nothing yet forces the *reason* a genuinely wrong vendor stub
needed suppressing in the first place -- that is what this scanner does. The valve
exists on purpose: a zero-suppression policy with no escape hatch just pushes the
pressure onto an untyped `object` plus runtime asserts, with no comment saying so.
Using the valve costs a reason comment visible in the diff.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_THIS_FILE_RELATIVE = Path(__file__).resolve().relative_to(REPO_ROOT)

# The reason marker is assembled from parts at runtime rather than written as one
# literal in this file's own source. Written as a literal, this file would contain
# the exact string the scanner searches for, which forces one of two bad choices:
# special-case this file's own path (fragile -- easy to forget on a rename), or let
# the scanner report itself (a guard that flags its own source is not trustworthy).
# Excluding this file's own path (below) is the other half of the same protection --
# both, per plan.
_MARKER_PREFIX = "#"
_MARKER_WORD = "why"
REASON_MARKER = f"{_MARKER_PREFIX} {_MARKER_WORD}:"

# A suppression that names its rule: `# type: ignore[code]`, `# pyright: ignore[code]`,
# or ruff's own rule-code suppression comment (the pattern below, not spelled out
# here as a standalone comment, since ruff's own comment scanner would try to parse
# this sentence as one).
_RULE_CODED_SUPPRESSION = re.compile(
    r"#\s*(?:type:\s*ignore\[[^\]]+\]|pyright:\s*ignore\[[^\]]+\]|noqa:\s*\S+)"
)


def _tracked_python_files() -> list[Path]:
    """Every tracked `.py` file under `src/` and `tests/`, excluding the fixtures
    directory (deliberate violations, D-07) and this file's own path.

    `git ls-files` only, never a directory walk -- an untracked scratch file must
    never be able to fail the build.
    """
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


def find_unjustified_suppressions(paths: list[Path]) -> list[str]:
    """Return `path:lineno` for every rule-coded suppression missing a reason on
    the same line."""
    offenders: list[str] = []
    for path in paths:
        absolute_path = REPO_ROOT / path
        contents = absolute_path.read_text()
        for lineno, line in enumerate(contents.splitlines(), start=1):
            if _RULE_CODED_SUPPRESSION.search(line) and REASON_MARKER not in line:
                offenders.append(f"{path}:{lineno}")
    return offenders


def test_real_tree_has_no_unjustified_suppressions() -> None:
    offenders = find_unjustified_suppressions(_tracked_python_files())
    assert offenders == [], (
        "Rule-coded suppression(s) missing a reason (D-06):\n" + "\n".join(offenders)
    )


def test_scanner_reports_a_synthetic_offending_line(tmp_path: Path) -> None:
    """Proves the matcher fires -- a scanner that never rejects anything is
    decoration (same shape as D-07's negative controls)."""
    offending = tmp_path / "offending.py"
    offending.write_text("x = bad_call()  # type: ignore[call-arg]\n")
    offenders = find_unjustified_suppressions([offending])
    assert offenders == [f"{offending}:1"]


def test_justified_suppression_is_not_reported(tmp_path: Path) -> None:
    justified = tmp_path / "justified.py"
    justified.write_text(
        "x = bad_call()  # type: ignore[call-arg]  "
        + REASON_MARKER
        + " vendor stub returns Any\n"
    )
    assert find_unjustified_suppressions([justified]) == []


def test_line_with_no_suppression_at_all_is_not_reported(tmp_path: Path) -> None:
    clean = tmp_path / "clean.py"
    clean.write_text("x = 1\n")
    assert find_unjustified_suppressions([clean]) == []


def test_scanner_excludes_its_own_source_and_the_fixtures_directory() -> None:
    files = _tracked_python_files()
    assert _THIS_FILE_RELATIVE not in files
    assert not any(f.parts[:3] == ("tests", "gate", "fixtures") for f in files)
