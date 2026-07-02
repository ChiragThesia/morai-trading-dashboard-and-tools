# Schwab Re-Auth Runbook

Schwab refresh tokens hard-expire 7 days after issuance. No sliding window. When
the clock runs out, the sidecar cannot refresh either app's access token and Schwab
pulls pause. This runbook restores auth by running a local OAuth exchange and
restarting the sidecar.

## When to Run This

Run it when either signal appears:

- **Amber warning.** `GET /api/status` shows `refreshExpiresIn` non-null for either
  app. You're inside the T-24h window before expiry. Re-auth now, before it expires.
- **Red alert.** `GET /api/status` shows `status: "AUTH_EXPIRED"` for either app, or
  the web UI shows the AUTH_EXPIRED banner. Schwab pulls for that app are paused.

Either signal, same fix: run the exchange, then restart the sidecar.

## Step 1: Get the Auth URLs

Run from the repo root so Railway resolves the project link. `railway run
--service worker` injects the worker's environment (DB URL, both apps' keys and
secrets, callback URLs) so no secret needs to live in your shell.

```
railway run --service worker apps/sidecar/.venv/bin/python apps/sidecar/seed_token.py authurl
```

This prints one authorization URL per app (trader, market) and saves each app's
OAuth `state` to a temp file. It writes nothing to the database yet.

## Step 2: Log In and Exchange

Open each URL, log into Schwab, and authorize. Schwab redirects your browser to a
URL your browser can't load — that's expected. Copy the full redirected URL from
your browser's address bar for each app.

Run the exchange with both URLs, trader first:

```
railway run --service worker apps/sidecar/.venv/bin/python apps/sidecar/seed_token.py \
    exchange "<trader_redirect_url>" "<market_redirect_url>"
```

Replace `<trader_redirect_url>` and `<market_redirect_url>` with the URLs you
copied. **Never paste a real redirect URL into a doc, chat log, or commit** — it
carries a single-use Schwab authorization code. Treat it like a password until
it's consumed by this command.

The command prints a verification line per app (`seeded` or `MISSING`) and anchors
`refresh_issued_at` to the current time — the fresh start of the next 7-day clock.

**Alternative: one-shot login.** If you're at a terminal with a browser (not a
headless agent shell), `seed_token.py login` does both apps back-to-back with no
copy-paste: it opens your browser and auto-catches each redirect on a local
callback server. Same restart step follows either way.

## Step 3: Restart the Sidecar (Mandatory)

The running sidecar reads its Schwab token from Postgres exactly once, at
startup. It holds that token in memory for its entire process lifetime and never
re-reads the database — writing a fresh token row does not change what the
running process is using. The sidecar only picks up the new token by restarting:

```
railway redeploy --service sidecar -y
```

This restarts the existing deployment image. It does not rebuild or ship new
code — use `railway redeploy`, not `railway up`. Wait for the sidecar to report
healthy before verifying.

## Step 4: Verify Recovery

Check both signals:

1. **Sidecar health.** `/sidecar/health` is reachable and not degraded.
2. **Status freshness.** `GET /api/status` shows both apps fresh:
   `refreshExpiresIn` is `null` and `status` is no longer `AUTH_EXPIRED` for
   either app.

If both check out, recovery is complete. No code was rebuilt and no second
streamer session opened — the Postgres advisory lock (GW-04) held through the
restart.

## Related

- [deployment.md](../architecture/deployment.md) — Railway topology and token
  persistence.
- `apps/sidecar/seed_token.py` — the script this runbook documents.
