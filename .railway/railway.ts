import { defineRailway, github, postgres, preserve, project, service, volume } from "railway/iac";

// Both services point at the repo root (one installable package, D-18's src/
// layout, two entry points) and differ only in start command -- not a
// monorepo, so no distinct rootDirectory per service.
const REPO = "ChiragThesia/morai-trading-dashboard-and-tools";

export default defineRailway(() => {
  const Postgres = postgres("Postgres", { region: "us-east4-eqdc4a" });
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "us-east4-eqdc4a", sizeMB: 50000 });

  // The `[::]` dual-stack bind is this phase's spike deliverable (V039):
  // Railway's public edge is IPv4-only, its private network is IPv6, and one
  // socket must serve both. Do not change this bind. Migrations run only
  // here -- two services racing one `alembic upgrade head` deadlocks on the
  // first slow migration.
  const web = service("web", {
    source: github(REPO, { rootDirectory: "." }),
    // Double quotes around the bind, not single. Single quotes stop the shell
    // expanding $PORT, so hypercorn receives the literal "[::]:$PORT", tries to
    // resolve $PORT as a service name, and dies with
    // `socket.gaierror: [Errno -2] Name or service not known` before it ever
    // listens -- which then presents as a healthcheck timeout rather than as a
    // config error. Measured on deploy 7b637749.
    start: 'alembic upgrade head && hypercorn --bind "[::]:$PORT" morai.api.app:app',
    healthcheck: "/health",
    env: {
      DATABASE_URL: Postgres.env.DATABASE_URL,
      // `preserve()` keeps whatever is already set in Railway. Both of these
      // are secrets and neither may ever appear in a tracked file, so the
      // value is set once out of band; what this file owns is the *fact that
      // the service requires them*. Without these two lines a
      // `railway config apply` would strip both, and the failure would present
      // as a healthcheck timeout rather than as missing configuration.
      //
      // MORAI_APP_DB_PASSWORD: the password for the least-privilege `morai_app`
      // role migration 0003 creates. `db/session.py`'s `get_app_engine` builds
      // every request's connection from it, and that connection is
      // NOSUPERUSER/NOBYPASSRLS -- it is what makes AUTH-07's isolation real
      // rather than advisory. Absent it the web service cannot serve a request.
      //
      // MORAI_MASTER_KEY: the KEK that unwraps each user's data key
      // (CRYPT-01, migration 0007). Base64 of exactly 32 bytes for AES-256-GCM;
      // `settings.master_key_bytes` refuses to start otherwise. Required by
      // `ledger/fills.py`, `ledger/events.py` and `vendor/connections.py`.
      MORAI_APP_DB_PASSWORD: preserve(),
      MORAI_MASTER_KEY: preserve(),
      // Phase 4: `settings.schwab_credentials` requires all three of these,
      // and `SchwabAuthAdapter` raises if any is missing -- but the fields
      // are Optional on `Settings`, so the app still boots and passes
      // healthcheck without them. Absent them, the failure surfaces later
      // and silently: a 500 on the first real user's "Connect Schwab"
      // click, not a healthcheck timeout. Same `preserve()` reasoning as
      // MORAI_APP_DB_PASSWORD/MORAI_MASTER_KEY above -- these are secrets,
      // set once out of band, never in a tracked file.
      SCHWAB_API_KEY: preserve(),
      SCHWAB_APP_SECRET: preserve(),
      SCHWAB_CALLBACK_URL: preserve(),
    },
  });

  // The worker deliberately gets neither secret yet. It holds its own psycopg
  // v3 pool built straight from DATABASE_URL (see `worker/app.py`), never
  // `get_app_engine`, and nothing it runs touches the crypto path today. Both
  // become required here when Phase 6's ingest starts writing encrypted fills
  // from a background job -- add them at that point, not speculatively now.
  const worker = service("worker", {
    source: github(REPO, { rootDirectory: "." }),
    start: "procrastinate --app morai.worker.app.app worker",
    env: { DATABASE_URL: Postgres.env.DATABASE_URL },
  });

  return project("morai-journal", {
    resources: [Postgres, postgresVolume, web, worker],
  });
});
