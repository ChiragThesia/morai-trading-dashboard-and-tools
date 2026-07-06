/**
 * register-open-calendars-cli.ts — ONE-OFF CLI to auto-register the current open position
 * book as journal calendars (JRNL-02). Run via `railway run` (injects prod env), same pattern
 * as backfill-transactions.ts / fix-pnl-reingest.ts. Thin composition root — TDD-exempt wiring
 * (tdd.md Scope): it only sequences the already-tested registerOpenCalendars use-case.
 *
 * Exists because the HTTP /api/jobs/register-open-calendars/trigger route is gated by the
 * static MCP bearer token (not the user JWT), and the streamable-MCP trigger_job enum is cached
 * per-connection — so triggering the freshly-added job from an existing session is impractical.
 * This calls the use-case directly against prod (positions + fills + calendars) instead.
 *
 * No any/as/! (typescript.md). No secret/token in output (workflow.md Data Discipline).
 */

if (import.meta.main) {
  const { bootWorkerConfig } = await import("./config.ts");
  const {
    makeDb,
    makePostgresFillsRepo,
    makePostgresCalendarsRepo,
    makePostgresBrokerTokensRepo,
    makeAccountHashResolver,
    makeSchwabPositionsAdapter,
  } = await import("@morai/adapters");
  const {
    makeGetPositionsUseCase,
    makeRegisterCalendarUseCase,
    makeRegisterOpenCalendarsUseCase,
  } = await import("@morai/core");

  const config = bootWorkerConfig();
  const db = makeDb(config.DATABASE_URL);
  const fillsRepo = makePostgresFillsRepo(db);
  const calendarsRepo = makePostgresCalendarsRepo(db);
  const brokerTokensRepo = makePostgresBrokerTokensRepo(
    db,
    config.TOKEN_ENCRYPTION_KEY,
  );

  const traderGetAccessToken = async () => {
    const result = await brokerTokensRepo.readTokens("trader");
    if (!result.ok || result.value === null) {
      return {
        ok: false as const,
        error: { kind: "auth-expired" as const, appId: "trader" as const },
      };
    }
    return { ok: true as const, value: result.value.accessToken };
  };
  const traderDeps = {
    fetch: globalThis.fetch,
    getAccessToken: traderGetAccessToken,
    userAgent: "morai-worker/0.0.1",
  };

  const accountHashResolver = makeAccountHashResolver(traderDeps);
  const positionsAdapter = makeSchwabPositionsAdapter(traderDeps);
  const getPositionsUseCase = makeGetPositionsUseCase({
    resolveAccountHash: accountHashResolver.resolveAccountHash,
    fetchPositions: positionsAdapter.fetchPositions,
  });

  // Mirror apps/worker/src/main.ts: map BrokerPosition → journal PositionLeg + FetchError.
  const fetchOpenPositionLegs = async () => {
    const result = await getPositionsUseCase();
    if (!result.ok) {
      const message =
        result.error.kind === "auth-expired"
          ? `brokerage auth expired for app ${result.error.appId}`
          : result.error.message;
      return { ok: false as const, error: { kind: "fetch-error" as const, message } };
    }
    const legs = result.value.map((p) => ({
      occSymbol: p.occSymbol,
      underlyingSymbol: p.underlyingSymbol,
      longQty: p.longQty,
      shortQty: p.shortQty,
      averagePrice: p.averagePrice,
    }));
    return { ok: true as const, value: legs };
  };

  const registerCalendarUseCase = makeRegisterCalendarUseCase({
    persistCalendar: calendarsRepo.registerCalendar,
    now: () => new Date(),
  });

  const registerOpenCalendars = makeRegisterOpenCalendarsUseCase({
    fetchOpenPositions: fetchOpenPositionLegs,
    listCalendars: calendarsRepo.listCalendars,
    readFillsByOccSymbols: fillsRepo.readFillsByOccSymbols,
    registerCalendar: registerCalendarUseCase,
    now: () => new Date(),
  });

  console.warn("register-open-calendars: reading open position book + registering...");
  const result = await registerOpenCalendars();
  if (!result.ok) {
    console.error(`register-open-calendars FAILED: ${result.error.message ?? result.error.kind}`);
    process.exit(1);
  }

  const { registered, skippedExisting } = result.value;
  console.warn(`register-open-calendars: registered ${registered.length}, skipped ${skippedExisting.length} existing.`);
  for (const r of registered) {
    console.warn(
      `  + ${r.underlying} ${r.strike / 1000}${r.optionType} ${r.frontExpiry}/${r.backExpiry}  ` +
        `openNetDebit=${r.openNetDebit.toFixed(4)}  id=${r.calendarId}  openedAtSource=${r.openedAtSource}`,
    );
  }
  process.exit(0);
}
