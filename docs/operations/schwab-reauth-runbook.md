# Schwab Re-Auth Runbook

Schwab refresh tokens hard-expire 7 days after issuance. No sliding window. When
the clock runs out, the sidecar cannot refresh either app's access token and Schwab
pulls pause. This runbook restores auth from the browser, through the in-app
Reconnect wizard. A CLI fallback stays available for when the app itself is down.

## When to Run This

Run it when either signal appears:

- **Amber warning.** The web UI shows the AuthExpiredBanner in its amber state
  (`GET /api/status` shows `refreshExpiresIn` non-null for either app). You're
  inside the T-24h window before expiry. Re-auth now, before it expires.
- **Red alert.** The banner shows red (`GET /api/status` shows `status:
  "AUTH_EXPIRED"` for either app). Schwab pulls for that app are paused.

Either signal, same fix: open the wizard from the banner and reconnect.

## Primary Path: The In-App Wizard

From any authenticated screen on morai.wtf:

1. Click **Reconnect** on the AuthExpiredBanner (visible in both its amber and red
   states).
2. The wizard opens with a two-step indicator: **Trader (1/2)** then **Market
   (2/2)**. Click **Authorize** on the Trader step. This opens Schwab's login page.
3. Log into Schwab and authorize. Schwab redirects your browser back to
   `https://morai.wtf` with `?code=&state=` in the URL. The app strips those
   params from the address bar immediately, exchanges the code for a token behind
   the scenes, and advances the wizard to the Market step automatically — no
   confirm screen, no copy-pasting a URL.
4. Click **Authorize** on the Market step and repeat: log in, authorize, land back
   on morai.wtf, wizard advances to Done.
5. Close the wizard. The AuthExpiredBanner clears within about 30 seconds (the
   next `/api/status` poll picks up the fresh tokens).

No terminal, no CLI, and no sidecar restart — the sidecar re-initializes its
Schwab clients in-process the moment each exchange succeeds.

**If one app's step fails** ("reconnect failed — Schwab didn't confirm a fresh
token"), retry only that step. The other app's already-fresh token is untouched —
same partial-failure isolation as the CLI's "do NOT restart the sidecar; re-run
for the failed app" rule below.

## Fallback: The CLI (`seed_token.py`)

Use this only when the wizard itself is unavailable — for example, the app is
down. It requires a terminal and Railway CLI access.

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

**Prefer one-shot login when you have a browser at hand.** Schwab's
authorization code expires around 30 seconds after you copy it. Logging into
both apps first and pasting both URLs afterward risks losing that race for
whichever app you authorized first. `seed_token.py login` avoids this: it
opens your browser and auto-catches each redirect on a local callback server
as soon as you authorize, one app at a time. Use two-step `exchange` only from
a headless agent shell with no local browser. Same restart step follows
either way.

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

## Deploy Prerequisites (Railway)

Set these before deploying the wizard — a missing or mismatched value fails
every exchange:

- `SIDECAR_ADMIN_TOKEN` — one strong random secret (16+ chars). Set the
  **same value** on both the Railway `server` service and the `sidecar`
  service. The server sends this as a header on the two admin endpoints; the
  sidecar checks it with a constant-time compare. A mismatch 401s every
  exchange.
- `SCHWAB_WEB_CALLBACK_URL` — set to `https://morai.wtf` on the `sidecar`
  service (the server doesn't need it). This must match the callback URL
  registered on both Schwab Developer Portal apps exactly, or Schwab rejects
  the exchange with a `redirect_uri` mismatch.

Confirm `https://morai.wtf` is registered as a callback URL on **both** the
trader and market Schwab apps (Schwab Developer Portal → each app → Callback
URLs) before the first wizard run.

Never commit an actual secret value — only the variable names and where they
go, as above.

## Related

- [deployment.md](../architecture/deployment.md) — Railway topology and token
  persistence.
- `apps/sidecar/seed_token.py` — the script this runbook documents.
