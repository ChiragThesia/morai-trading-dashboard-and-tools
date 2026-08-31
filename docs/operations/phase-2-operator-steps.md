# Phase 2 Operator Steps

Four steps, in dependency order. Each names its exact command and what output counts as
success.

## What is proven, and what is not

Proven in CI: every claim in Phase 2, including the isolation suite against `morai_app`, a
role that genuinely cannot bypass RLS — CI creates both `morai_app` and the superuser role
itself, so the negative case (a cross-user read returning nothing) is asserted, not assumed.

Not proven: anything on the deployed Railway service. Steps 2 through 4 below are the
deployment half of Phase 2, and no code in this phase depends on them having run. Login,
logout, session revocation, tenant isolation, and the audit log all pass their own tests
against real Postgres in CI today, with no dependency on Railway.

## Step 1 — set `MORAI_APP_DB_PASSWORD`

Generate a password:

```
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

Set it on **both** the `web` and the `worker` Railway services. One `Settings` model backs
both processes, and a variable missing on one of them fails that process at the point of
use, not at boot.

Never commit this value. This repository is public.

**Success:** `railway variables --service web` lists `MORAI_APP_DB_PASSWORD` by name (not
its value). Repeat for `--service worker`.

This step was blocked by the permission classifier active in the session that wrote Phase
2. It is the first thing a human does here.

## Step 2 — deploy, and confirm the migration ran

The `web` service's start command runs `alembic upgrade head` before hypercorn
(`.railway/railway.ts`). A deploy is what runs it.

**Success looks like three things in the deploy log, in order:**

1. Migration 0003 applies (`Running upgrade 0002 -> 0003`), followed by 0004
   (`Running upgrade 0003 -> 0004`). Migration 0004 exists because `/login` needs one read
   of `users` by username before any RLS context exists — see
   `alembic/versions/0004_login_lookup.py`'s own docstring for why that read is a narrow
   `SECURITY DEFINER` function, not a wider RLS policy.
2. No `RuntimeError` from migration 0003's own role assertion. A raised assertion means the
   role Alembic connects as is not a superuser, and the whole RLS design needs revisiting —
   this is the inference `02-RESEARCH.md` flagged at commit `128d7a2`.
3. The process reaches hypercorn's listen line.

**What each failure means:**

- A role-assertion `RuntimeError` — the connecting role is not a Postgres superuser. Revisit
  the RLS design before retrying; do not work around it.
- A missing-variable error — step 1 did not take on this service. Re-check
  `railway variables --service web` (or `--service worker`).

## Step 3 — create the first admin

```
railway run --service web uv run python tools/create_admin.py <username>
```

This prints one token to stdout and nothing else secret. That token is bearer-equivalent:
hand it to the new admin out of band, and it cannot be reissued — losing it means deleting
the row this script created and running it again.

Then the new admin sets their password through `POST /setup` with that token.

**Success:** the script exits 0 and prints exactly one token. `tools/create_admin.py`
refuses with a non-zero exit if an admin already exists — do not run this a second time.

## Step 4 — the two owed measurements

### (a) Argon2id timing

```
railway run --service web uv run python tools/measure_argon2.py
```

Compare the `128 MiB / t=3 / p=1` row against the M1 Pro table in `02-RESEARCH.md` and the
local numbers in `02-03-SUMMARY.md`.

If it lands meaningfully over 400 ms, reduce `time_cost` first (3 → 2) — that stays inside
OWASP's documented range. Only drop `memory_cost` below OWASP's 19 MiB floor as a last
resort, and write down why: these accounts are linked to brokerage credentials, which is
D2-03's whole reason for the higher band.

### (b) The isolation smoke test

```
uv run python tools/isolation_smoke.py \
    --base-url https://web-production-183cf.up.railway.app \
    --admin-cookie <morai_session for the admin user> \
    --user-cookie <morai_session for a non-admin user who owns a probe row>
```

Get both cookies by logging in through `POST /login` (an admin account, and a non-admin
account that owns at least one `gate_user_scoped_probe` row — the tracer route from plan
02-01 seeds this data, or seed one directly).

**Success:** `isolation_smoke: all checks passed`, exit 0. This is D2-10's live run — the
same isolation claim CI already proves, now proven against the actual deployment.

## The one-line check this plan owes

`02-RESEARCH.md` asks for this exact query, run by hand against Railway, with its literal
output recorded here:

```
SELECT rolsuper FROM pg_roles WHERE rolname = current_user;
```

Migration 0003 already asserts this and fails loudly if it is false — step 2 covers it. But
the literal output, recorded below, turns an inference into a measurement:

```
rolsuper
----------
(not yet run — deploy is blocked in this session; see "What is proven" above)
```
