import { defineRailway, github, postgres, project, service, volume } from "railway/iac";

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
    start: "alembic upgrade head && hypercorn --bind '[::]:$PORT' morai.api.app:app",
    healthcheck: "/health",
    env: { DATABASE_URL: Postgres.env.DATABASE_URL },
  });

  const worker = service("worker", {
    source: github(REPO, { rootDirectory: "." }),
    start: "procrastinate --app morai.worker.app.app worker",
    env: { DATABASE_URL: Postgres.env.DATABASE_URL },
  });

  return project("morai-journal", {
    resources: [Postgres, postgresVolume, web, worker],
  });
});
