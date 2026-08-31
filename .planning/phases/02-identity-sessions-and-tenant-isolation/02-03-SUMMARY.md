---
phase: 02-identity-sessions-and-tenant-isolation
plan: 03
subsystem: auth
tags: [argon2, argon2-cffi, password-hashing, owasp]

requires:
  - phase: 02-identity-sessions-and-tenant-isolation
    provides: "02-01's users table (password_hash column) and identity/ module layout"
provides:
  - "identity/passwords.py -- hash_password, verify_password, needs_rehash at Argon2id's OWASP higher-security band (128 MiB / t=3 / p=1)"
  - "tools/measure_argon2.py -- the committed, runnable Railway measurement script, owed and documented as such"
affects: [02-05, 02-06]

actuals:
  tokens: 2100
  tasks: 2
  commits: 2

tech-stack:
  added: ["argon2-cffi==25.1.0"]
  patterns:
    - "One module-level PasswordHasher, built once, not per call"
    - "Parameter verification parses the produced hash string ($argon2id$v=19$m=...,t=...,p=...$) rather than trusting the constructor argument"
    - "verify_password catches both VerifyMismatchError and InvalidHashError, returning False for either -- a malformed stored hash is a rejected login, not a 500"

key-files:
  created:
    - src/morai/identity/passwords.py
    - tests/identity/test_passwords.py
    - tools/measure_argon2.py
  modified:
    - pyproject.toml
    - uv.lock

key-decisions:
  - "Shipped safe defaults (128 MiB / t=3 / p=1) measured locally as a floor, not a deployed answer -- the Railway measurement stays owed, recorded as a deferred post-deploy task with a runnable script and a written fallback order, rather than guessed or silently skipped."
  - "No parameter in passwords.py changed on the strength of the local measure_argon2.py run -- D2-03 asks for the container number specifically."

requirements-completed: [AUTH-03]

coverage:
  - id: D1
    description: "Argon2id password hashing at OWASP's higher-security band, with parameters verified by parsing the produced hash string"
    requirement: "AUTH-03"
    verification:
      - kind: unit
        ref: "tests/identity/test_passwords.py#test_hash_parameters_read_from_hash_string"
        status: pass
      - kind: unit
        ref: "tests/identity/test_passwords.py#test_verify_password_accepts_own_hash"
        status: pass
      - kind: unit
        ref: "tests/identity/test_passwords.py#test_verify_password_rejects_wrong_password_without_raising"
        status: pass
      - kind: unit
        ref: "tests/identity/test_passwords.py#test_verify_password_rejects_malformed_hash_without_raising"
        status: pass
      - kind: unit
        ref: "tests/identity/test_passwords.py#test_hash_password_uses_per_hash_salt"
        status: pass
      - kind: unit
        ref: "tests/identity/test_passwords.py#test_needs_rehash_false_for_current_params_true_for_weaker"
        status: pass
      - kind: unit
        ref: "tests/identity/test_passwords.py#test_no_secret_leaks_in_repr_or_logs"
        status: pass
    human_judgment: false
  - id: D2
    description: "Railway CPU-timing measurement for the shipped Argon2id parameters"
    verification: []
    human_judgment: true
    rationale: "Deploys are blocked by this session's permission classifier -- this deliverable is explicitly recorded as owed, not completed. A human must run tools/measure_argon2.py against the deployed Railway web service and confirm the result lands inside the 250-400 ms band (or apply the documented fallback order) before this is closed out."

duration: 12min
completed: 2026-08-31
status: complete
---

# Phase 2 Plan 3: Argon2id Password Hashing Summary

**Argon2id via argon2-cffi 25.1.0 at OWASP's higher-security band (128 MiB / t=3 / p=1), with the Railway CPU-timing measurement recorded as owed rather than faked.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-08-31T05:00Z (approx)
- **Completed:** 2026-08-31T05:12Z
- **Tasks:** 2
- **Files modified:** 5 (pyproject.toml, uv.lock, src/morai/identity/passwords.py, tests/identity/test_passwords.py, tools/measure_argon2.py)

## Accomplishments

- `identity/passwords.py`: `hash_password`, `verify_password`, `needs_rehash`, one module-level `PasswordHasher` at `time_cost=3, memory_cost=131072 (128 MiB), parallelism=1` -- OWASP's higher-security band per D2-03, because these accounts are linked to brokerage credentials.
- Seven tests, red before green: a hash verifies against itself; a wrong password returns `False` without raising; two hashes of the same password differ (per-hash salt); the parameters are read back out of the produced `$argon2id$v=19$m=131072,t=3,p=1$...` hash string rather than asserted against the constructor argument; `needs_rehash` is `False` for a current-parameter hash and `True` for one from a deliberately weaker `PasswordHasher`; a malformed hash string returns `False` rather than raising; the wrong-password path emits no log record and leaks neither the password nor the hash.
- `tools/measure_argon2.py`: reproduces `02-RESEARCH.md`'s six-combination benchmark table with stdlib `time.perf_counter`, no new dependency. Its docstring states plainly that the Railway run has not happened, gives the exact command (`railway run --service web uv run python tools/measure_argon2.py`) and the fallback order (`time_cost` down before `memory_cost` ever drops below OWASP's floor).

## Task Commits

Each task was committed atomically:

1. **Task 1: Argon2id hashing, with the parameters read back out of the hash** - `ae38aa8` (feat)
2. **Task 2: The measurement script, and the tuning recorded as owed** - `b6827e4` (chore)

_No separate red-then-green commits: TDD discipline was followed (tests written and run to failure before implementation), but the plan's own commit protocol calls for one commit per task, matching the pattern already established by plan 02-01._

## Files Created/Modified

- `pyproject.toml` - added `argon2-cffi==25.1.0`, exact pin
- `uv.lock` - regenerated by `uv add`, committed alongside so `uv sync --frozen` stays in agreement
- `src/morai/identity/passwords.py` - `hash_password`/`verify_password`/`needs_rehash`, module docstring carries the parameter rationale and the fallback order
- `tests/identity/test_passwords.py` - seven tests covering acceptance, rejection, salting, parameter verification, rehash detection, malformed-hash handling, and NN-34 leak-freedom
- `tools/measure_argon2.py` - the committed Railway measurement script

## Decisions Made

- Shipped the safe local-measured defaults (`128 MiB / t=3 / p=1`) as a **floor**, not the deployed answer. D2-03 requires the Railway measurement specifically; a laptop-tuned cost was explicitly named in `02-RESEARCH.md` as meaningless for this decision.
- The Railway measurement stays **owed**, not silently skipped: `tools/measure_argon2.py` is committed and runnable, its docstring states the exact command and the fallback order, and this SUMMARY's `coverage` block routes that deliverable to a human via `human_judgment: true` rather than auto-passing it.
- `type=Type.ID` was not passed to `PasswordHasher` -- confirmed from the installed package's own `__init__` signature that it is already the default, so passing it would be one more redundant thing to keep in agreement with the library.

## Deviations from Plan

None - plan executed exactly as written. Both Orchestrator Addenda in `02-RESEARCH.md` (CI's own Postgres superuser, and the `SET LOCAL`/`set_config` correction) concern the RLS/session-wiring code in `sessions.py`, not this plan's files; neither required a change here.

## Verification Evidence

**Red (before implementation):**

```
ImportError while importing test module '.../tests/identity/test_passwords.py'.
tests/identity/test_passwords.py:14: in <module>
    from argon2 import PasswordHasher
E   ModuleNotFoundError: No module named 'argon2'
```

**Green (after implementation):**

```
$ uv run pytest tests/identity/test_passwords.py -x -q -v
.......                                                                  [100%]
7 passed in 2.95s
```

**Full verification chain, all clean:**

```
$ uv sync --frozen        -> Checked 64 packages in 2ms
$ uv run basedpyright     -> 0 errors, 0 warnings, 0 notes
$ uv run mypy src tests   -> Success: no issues found in 41 source files
$ uv run ruff check src tests -> All checks passed!
$ uv run pytest tests/gate/ -q -> 29 passed
```

**`tools/measure_argon2.py`, run locally (this machine, not Railway):**

```
memory_cost=19456KiB (19MiB) time_cost=2 parallelism=1 -> 22.1ms
memory_cost=131072KiB (128MiB) time_cost=3 parallelism=1 -> 270.5ms
memory_cost=131072KiB (128MiB) time_cost=3 parallelism=2 -> 131.1ms
memory_cost=131072KiB (128MiB) time_cost=5 parallelism=1 -> 435.5ms
memory_cost=65536KiB (64MiB) time_cost=3 parallelism=1 -> 136.4ms
memory_cost=46137KiB (45MiB) time_cost=1 parallelism=1 -> 24.6ms
```

**`02-RESEARCH.md`'s M1 Pro numbers, for comparison (recorded there, not re-measured here):**

```
memory_cost=19456KiB (19MiB) time_cost=2 parallelism=1 -> 31.8ms   (OWASP minimum band)
memory_cost=131072KiB (128MiB) time_cost=3 parallelism=1 -> 276.4ms (recommended -- lands in target)
memory_cost=131072KiB (128MiB) time_cost=3 parallelism=2 -> 137.3ms
memory_cost=131072KiB (128MiB) time_cost=5 parallelism=1 -> 437.8ms (slightly over 400ms)
memory_cost=65536KiB (64MiB) time_cost=3 parallelism=1 -> 135.2ms   (fallback if 128MiB is too slow)
memory_cost=46137KiB (45MiB) time_cost=1 parallelism=1 -> 25.5ms    (OWASP's 2nd documented option)
```

The two machines land within a few ms of each other on every row -- both Apple Silicon laptops, as expected. **Neither number is the Railway number.** The Railway measurement is explicitly not taken: deploys are blocked by this session's permission classifier. It is recorded here as an owed, deferred post-deploy task (see the `D2` entry in this file's `coverage` block and `tools/measure_argon2.py`'s own docstring), with the exact command to run it and the fallback order to apply if it lands over ~400 ms, not silently dropped and not guessed at.

## NN-34 Proof (no secret leaks)

`verify_password`'s wrong-password path is exercised under `caplog` at `DEBUG` level: `caplog.records == []` after the call, and neither the password nor the produced hash string appears anywhere in `caplog.text`. The underlying library's own exceptions were also checked directly this session (not asserted in the committed test, since `verify_password` catches both internally and neither ever escapes to a caller): `VerifyMismatchError`'s message is `"The password does not match the supplied hash"` (no password in it), and `InvalidHashError`'s `repr()` carries no hash content. `hash_password`/`verify_password`/`needs_rehash` return only a `str` or a `bool` -- there is no object a caller could accidentally `repr()` that would carry a secret.

## Issues Encountered

None.

## User Setup Required

None for this plan directly. The Railway timing measurement (see `D2` above) is a deferred, human-run post-deploy task: `railway run --service web uv run python tools/measure_argon2.py`, result compared against the 250-400 ms band, fallback order in `tools/measure_argon2.py`'s docstring if it lands over that.

## Next Phase Readiness

- `hash_password`/`verify_password`/`needs_rehash` are ready for the login route (plan 02-05/02-06) to call directly.
- The Railway measurement remains an open item, tracked here rather than lost -- whoever wires the login route should not treat the shipped parameters as final without either running `tools/measure_argon2.py` on Railway or explicitly accepting the local floor as good enough for now.

---
*Phase: 02-identity-sessions-and-tenant-isolation*
*Completed: 2026-08-31*

## Self-Check: PASSED

- FOUND: src/morai/identity/passwords.py
- FOUND: tests/identity/test_passwords.py
- FOUND: tools/measure_argon2.py
- FOUND: ae38aa8 (feat commit)
- FOUND: b6827e4 (chore commit)
