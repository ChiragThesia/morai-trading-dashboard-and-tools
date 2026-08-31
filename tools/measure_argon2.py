"""Reproduces `02-RESEARCH.md`'s Argon2id benchmark table, so a run's numbers
can be diffed by eye against the Apple M1 Pro numbers already recorded there.

**This has not been run on Railway.** Deploys are blocked by the permission
classifier active in this session. The Railway measurement D2-03 asks for is
owed, not done -- run this script there once a deploy is possible:

    railway run --service web uv run python tools/measure_argon2.py

**Fallback order, if the measured time lands meaningfully over ~400 ms:**
reduce `time_cost` first (3 -> 2) -- that stays inside OWASP's documented
acceptable range. Only drop `memory_cost` below OWASP's 19 MiB floor as a
genuine last resort, and treat that as a decision a human makes with the
reason written down: these accounts are linked to brokerage credentials
(D2-03), and memory hardness is what makes GPU attacks expensive.

Do not change `src/morai/identity/passwords.py`'s defaults on the strength of
a number this script prints locally -- a laptop measurement is a floor, not
the deployed answer (see that module's own docstring). Only the Railway run
above should inform a parameter change, and even then per the fallback order
above, not by dropping straight to whatever number looks fastest.
"""

from __future__ import annotations

import time

from argon2 import PasswordHasher

_PASSWORD = "correct horse battery staple"

# Mirrors `02-RESEARCH.md`'s "Local benchmark" table exactly, so the two are
# comparable line for line.
_COMBINATIONS: list[tuple[int, int, int]] = [
    (19456, 2, 1),  # 19 MiB -- OWASP minimum band
    (131072, 3, 1),  # 128 MiB -- recommended, this project's shipped default
    (131072, 3, 2),
    (131072, 5, 1),
    (65536, 3, 1),  # 64 MiB -- fallback if 128 MiB is too slow
    (46137, 1, 1),  # 45 MiB -- OWASP's 2nd documented option
]


def _measure(memory_cost: int, time_cost: int, parallelism: int) -> float:
    hasher = PasswordHasher(
        time_cost=time_cost, memory_cost=memory_cost, parallelism=parallelism
    )
    start = time.perf_counter()
    hasher.hash(_PASSWORD)
    return (time.perf_counter() - start) * 1000


def main() -> None:
    for memory_cost, time_cost, parallelism in _COMBINATIONS:
        elapsed_ms = _measure(memory_cost, time_cost, parallelism)
        memory_mib = memory_cost / 1024
        print(
            f"memory_cost={memory_cost}KiB ({memory_mib:.0f}MiB) "
            f"time_cost={time_cost} parallelism={parallelism} "
            f"-> {elapsed_ms:.1f}ms"
        )


if __name__ == "__main__":
    main()
