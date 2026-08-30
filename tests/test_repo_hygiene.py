"""Repo hygiene guards (criterion 6), both live for a public repository on an
iCloud-synced Desktop.

`V091`: iCloud silently duplicates a file with a ` 2` suffix on write conflict, and
two such files already reached git history before this test existed (D-20). Research
finding 8: the repository is public, so a committed `.env` or a Postgres URL carrying
a password would be visible to anyone.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
_THIS_FILE_RELATIVE = Path(__file__).resolve().relative_to(REPO_ROOT)

# A space, the digit two, then either end of name or a dot -- "foo 2.md",
# "CotCard.test 2.tsx" (V091). Matched against a path component so a collision
# anywhere in the tree is caught, not only at the repo root.
_ICLOUD_COLLISION = re.compile(r" 2(\.[^/]*)?$")

# A Postgres URL carrying a userinfo password: scheme://user:password@host.
_POSTGRES_URL_WITH_PASSWORD = re.compile(
    r"postgres(?:ql)?://[^:/\s]+:(?P<password>[^@/\s]+)@"
)

# Directories a learnings entry or a planning doc may legitimately discuss a
# connection-string *shape* in, without that discussion being able to fail the build.
_EXCLUDED_SCAN_DIRS = ("docs/", "knowledge-base/", ".planning/")


def _git_ls_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files"], cwd=REPO_ROOT, capture_output=True, text=True, check=True
    )
    return [line for line in result.stdout.splitlines() if line]


def _looks_like_a_real_credential(password: str) -> bool:
    """Distinguish a real, vendor-issued secret from a test or example placeholder
    by shape alone: length, plus a mix of letters and digits.

    Every placeholder already committed here (`.env.example`, CI's throwaway local
    Postgres password, the synthetic DSNs in `tests/conftest.py` and
    `tests/test_settings.py`) is a short, letters-only word. A real Railway-issued
    password is long and alphanumeric. This never inspects a real password's actual
    value -- only what a value shaped like one looks like.
    """
    return (
        len(password) >= 16
        and any(char.isdigit() for char in password)
        and any(char.isalpha() for char in password)
    )


def test_no_tracked_path_matches_icloud_collision_pattern() -> None:
    offenders = [p for p in _git_ls_files() if _ICLOUD_COLLISION.search(p)]
    assert offenders == [], f"iCloud collision artifact(s) tracked (V091): {offenders}"


def test_collision_matcher_fires_on_a_synthetic_offending_path() -> None:
    """The matcher must not pass vacuously just because the tree is clean today."""
    assert _ICLOUD_COLLISION.search("docs/learnings/LAWS 2.md")
    assert _ICLOUD_COLLISION.search("apps/web/src/components/CotCard.test 2.tsx")
    assert not _ICLOUD_COLLISION.search("docs/learnings/LAWS.md")


def test_env_and_env_local_are_untracked() -> None:
    tracked = set(_git_ls_files())
    assert ".env" not in tracked
    assert ".env.local" not in tracked


def test_env_never_reached_git_history() -> None:
    result = subprocess.run(
        ["git", "log", "--all", "--", ".env"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout.strip() == ""


def test_no_tracked_file_carries_a_real_looking_postgres_password() -> None:
    excluded_files = {".env.example", str(_THIS_FILE_RELATIVE)}
    offenders: list[str] = []
    for rel_path in _git_ls_files():
        if rel_path in excluded_files or rel_path.startswith(_EXCLUDED_SCAN_DIRS):
            continue
        absolute_path = REPO_ROOT / rel_path
        try:
            contents = absolute_path.read_text()
        except (UnicodeDecodeError, OSError):
            continue  # binary or unreadable -- not a text credential leak
        for match in _POSTGRES_URL_WITH_PASSWORD.finditer(contents):
            if _looks_like_a_real_credential(match.group("password")):
                offenders.append(rel_path)
                break
    assert offenders == [], (
        f"Postgres URL with a real-looking password tracked in: {offenders}"
    )


def test_env_example_holds_placeholders_only() -> None:
    contents = (REPO_ROOT / ".env.example").read_text()
    matches = list(_POSTGRES_URL_WITH_PASSWORD.finditer(contents))
    assert matches, ".env.example has no DATABASE_URL to check"
    for match in matches:
        assert not _looks_like_a_real_credential(match.group("password")), (
            "DATABASE_URL in .env.example looks like it may carry a real "
            "credential, not a placeholder"
        )
