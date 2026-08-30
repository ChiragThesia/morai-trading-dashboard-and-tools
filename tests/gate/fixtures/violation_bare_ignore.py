"""Deliberate negative control (D-07). Do not fix.

A bare `# type: ignore`, carrying no rule code, must fail the gate (ruff `PGH003`).
The line below genuinely needs a suppression -- assigning a `str` to an `int`-annotated
name -- so the failure being tested is the missing code, not the absence of an error to
suppress. Excluded from the real gate's own run (see `pyproject.toml`).
"""


def bad_ignore() -> int:
    x: int = "not an int"  # type: ignore
    return x
