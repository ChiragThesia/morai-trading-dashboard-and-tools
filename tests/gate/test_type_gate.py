"""Meta-test proving the type gate has teeth (D-07, T-01-18).

Each parametrized case runs a real checker, as a subprocess, against a fixture file
under `tests/gate/fixtures/` that deliberately violates exactly one rule -- and
asserts both a non-zero exit code and the specific rule marker the checker names when
it fires. A bare exit-code assertion would pass on a syntax error or a missing file
just as readily as on the intended violation; the marker is what proves the *right*
guard fired, not merely *a* guard.

`pyproject.toml` excludes `tests/gate/fixtures` from basedpyright, mypy and ruff, so
the real gate run stays clean with these fixtures on disk (D-07) -- but that exclusion
also applies to a checker invoked with an *explicit* path to a fixture file
[MEASURED locally, this session: `basedpyright` against
`tests/gate/fixtures/violation_explicit_any.py` directly reports 0 errors]. Each case
therefore copies its fixture into a directory outside `tests/gate/fixtures` before
invoking the checker, with this repository as the subprocess's working directory so
the copy still resolves against the project's own `pyproject.toml` config and its
installed `morai` package.

Marker note for the explicit-Any fixture: mypy does **not** flag it. `[tool.mypy]`
deliberately omits `disallow_any_explicit` -- it false-positives on every pydantic
`BaseModel`/`BaseSettings` subclass (see the comment on that block in `pyproject.toml`).
basedpyright's `reportExplicitAny`/`reportAny` and ruff's `TID251` already cover
explicit `Any`, so no mypy case is asserted for that fixture here. In its place, the
bare-ignore fixture gets a second real case: basedpyright's own mirror of ruff's
`PGH003`, `reportIgnoreCommentWithoutRule`, confirmed by hand before being pinned.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


def _run_checker_against_fixture(
    fixture_name: str, argv: list[str], tmp_path: Path
) -> subprocess.CompletedProcess[str]:
    """Copy `fixture_name` outside `tests/gate/fixtures` and run `[*argv, copy]`.

    The copy is what lets the checker actually see the violation -- an explicit path
    *inside* `tests/gate/fixtures` is silently excluded by `pyproject.toml` (D-07),
    which is correct for the real gate and wrong for proving this test's own claim.
    """
    fixture_path = FIXTURES_DIR / fixture_name
    copy_path = tmp_path / fixture_name
    shutil.copyfile(fixture_path, copy_path)
    return subprocess.run(
        [*argv, str(copy_path)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


CASES = [
    pytest.param(
        "violation_explicit_any.py",
        ["uv", "run", "basedpyright"],
        "reportExplicitAny",
        id="basedpyright-explicit_any-reportExplicitAny",
    ),
    pytest.param(
        "violation_explicit_any.py",
        ["uv", "run", "basedpyright"],
        "reportAny",
        id="basedpyright-explicit_any-reportAny",
    ),
    pytest.param(
        "violation_explicit_any.py",
        ["uv", "run", "ruff", "check"],
        "TID251",
        id="ruff-explicit_any-TID251",
    ),
    pytest.param(
        "violation_cast.py",
        ["uv", "run", "ruff", "check"],
        "TID251",
        id="ruff-cast-TID251",
    ),
    pytest.param(
        "violation_bare_ignore.py",
        ["uv", "run", "ruff", "check"],
        "PGH003",
        id="ruff-bare_ignore-PGH003",
    ),
    pytest.param(
        "violation_bare_ignore.py",
        ["uv", "run", "basedpyright"],
        "reportIgnoreCommentWithoutRule",
        id="basedpyright-bare_ignore-reportIgnoreCommentWithoutRule",
    ),
    pytest.param(
        "violation_unit_confusion.py",
        ["uv", "run", "basedpyright"],
        "reportArgumentType",
        id="basedpyright-unit_confusion-reportArgumentType",
    ),
    pytest.param(
        "violation_unit_confusion.py",
        ["uv", "run", "mypy"],
        "arg-type",
        id="mypy-unit_confusion-arg-type",
    ),
    pytest.param(
        "violation_unaudited_read.py",
        ["uv", "run", "basedpyright"],
        "reportArgumentType",
        id="basedpyright-unaudited_read-reportArgumentType",
    ),
    pytest.param(
        "violation_unaudited_read.py",
        ["uv", "run", "mypy"],
        "arg-type",
        id="mypy-unaudited_read-arg-type",
    ),
]


@pytest.mark.parametrize("fixture_name, argv, expected_marker", CASES)
def test_checker_rejects_fixture_with_expected_marker(
    fixture_name: str, argv: list[str], expected_marker: str, tmp_path: Path
) -> None:
    result = _run_checker_against_fixture(fixture_name, argv, tmp_path)
    combined_output = result.stdout + result.stderr
    assert result.returncode != 0, (
        f"{' '.join(argv)} exited 0 against {fixture_name}; expected a rejection.\n"
        f"output:\n{combined_output}"
    )
    assert expected_marker in combined_output, (
        f"{' '.join(argv)} against {fixture_name} did not name {expected_marker!r} "
        f"-- asserting only a non-zero exit would pass on the wrong failure.\n"
        f"output:\n{combined_output}"
    )


def test_fixtures_excluded_from_real_gate_run() -> None:
    """The four fixtures must not break the repo's own gate run (D-07).

    basedpyright, mypy and ruff all exclude `tests/gate/fixtures` in `pyproject.toml`.
    Confirmed here by running each the same way `tools/gate.sh` does, with the
    fixtures present on disk the whole time, and asserting a clean exit.
    """
    gate_invocations: list[list[str]] = [
        ["uv", "run", "ruff", "check", "src", "tests"],
        ["uv", "run", "basedpyright"],
        ["uv", "run", "mypy", "src", "tests"],
    ]
    for argv in gate_invocations:
        result = subprocess.run(
            argv, cwd=REPO_ROOT, capture_output=True, text=True, check=False
        )
        assert result.returncode == 0, (
            f"{' '.join(argv)} failed over the real tree with fixtures present -- "
            f"the exclusion is not real.\n{result.stdout}\n{result.stderr}"
        )
