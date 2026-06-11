import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import { makeGetStatusUseCase } from "./getStatus.ts";
import type { ForGettingStatus } from "./getStatus.ts";
import type { ForPingingDb, ForReadingJobRuns } from "./ports.ts";

// Define a minimal StorageError for test doubles — the real one is defined in ports.ts
type StorageError = { readonly kind: "storage-error"; readonly message: string };

function makeStorageError(message: string): StorageError {
  return { kind: "storage-error", message };
}

describe("makeGetStatusUseCase", () => {
  const version = "1.2.3";
  const startedAt = new Date(Date.now() - 5000); // started 5 seconds ago

  const noJobRuns: ForReadingJobRuns = async () => ok({});
  const errJobRuns: ForReadingJobRuns = async () =>
    err(makeStorageError("pgboss schema not ready"));

  it("returns db:'ok' when pingDb resolves ok", async () => {
    const pingDb: ForPingingDb = async () => ok(undefined);
    const getStatus: ForGettingStatus = makeGetStatusUseCase({
      pingDb,
      readJobRuns: noJobRuns,
      version,
      startedAt,
    });
    const result = await getStatus();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.db).toBe("ok");
    }
  });

  it("returns db:'down' when pingDb resolves err — never throws", async () => {
    const pingDb: ForPingingDb = async () => err(makeStorageError("connection refused"));
    const getStatus: ForGettingStatus = makeGetStatusUseCase({
      pingDb,
      readJobRuns: noJobRuns,
      version,
      startedAt,
    });
    const result = await getStatus();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.db).toBe("down");
    }
  });

  it("sets tokenFreshness to 'none yet'", async () => {
    const pingDb: ForPingingDb = async () => ok(undefined);
    const getStatus: ForGettingStatus = makeGetStatusUseCase({
      pingDb,
      readJobRuns: noJobRuns,
      version,
      startedAt,
    });
    const result = await getStatus();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tokenFreshness).toBe("none yet");
    }
  });

  it("returns lastJobRuns:'none yet' when readJobRuns returns empty map (first deploy)", async () => {
    const pingDb: ForPingingDb = async () => ok(undefined);
    const getStatus: ForGettingStatus = makeGetStatusUseCase({
      pingDb,
      readJobRuns: noJobRuns,
      version,
      startedAt,
    });
    const result = await getStatus();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lastJobRuns).toBe("none yet");
    }
  });

  it("returns lastJobRuns:'none yet' when readJobRuns errors (Pitfall 6 — never throw)", async () => {
    const pingDb: ForPingingDb = async () => ok(undefined);
    const getStatus: ForGettingStatus = makeGetStatusUseCase({
      pingDb,
      readJobRuns: errJobRuns,
      version,
      startedAt,
    });
    const result = await getStatus();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lastJobRuns).toBe("none yet");
    }
  });

  it("returns populated JobRunMap when readJobRuns has data", async () => {
    const pingDb: ForPingingDb = async () => ok(undefined);
    const populatedJobRuns: ForReadingJobRuns = async () =>
      ok({
        "fetch-cboe-chain": {
          lastSuccessAt: "2026-06-15T14:00:00.000Z",
          lastErrorAt: null,
          lastError: null,
        },
      });
    const getStatus: ForGettingStatus = makeGetStatusUseCase({
      pingDb,
      readJobRuns: populatedJobRuns,
      version,
      startedAt,
    });
    const result = await getStatus();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lastJobRuns).not.toBe("none yet");
      const jobRuns = result.value.lastJobRuns;
      if (jobRuns !== "none yet") {
        expect(jobRuns["fetch-cboe-chain"]?.lastSuccessAt).toBe(
          "2026-06-15T14:00:00.000Z",
        );
      }
    }
  });

  it("returns injected version string", async () => {
    const pingDb: ForPingingDb = async () => ok(undefined);
    const getStatus: ForGettingStatus = makeGetStatusUseCase({
      pingDb,
      readJobRuns: noJobRuns,
      version,
      startedAt,
    });
    const result = await getStatus();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.version).toBe("1.2.3");
    }
  });

  it("returns non-negative uptime derived from startedAt", async () => {
    const pingDb: ForPingingDb = async () => ok(undefined);
    const getStatus: ForGettingStatus = makeGetStatusUseCase({
      pingDb,
      readJobRuns: noJobRuns,
      version,
      startedAt,
    });
    const result = await getStatus();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.uptime).toBeGreaterThanOrEqual(0);
      // Uptime should be at least 5 seconds (startedAt was 5s ago)
      expect(result.value.uptime).toBeGreaterThanOrEqual(4);
    }
  });

  it("use-case never throws even when pingDb rejects", async () => {
    const pingDb: ForPingingDb = async () => {
      throw new Error("unexpected DB crash");
    };
    const getStatus: ForGettingStatus = makeGetStatusUseCase({
      pingDb,
      readJobRuns: noJobRuns,
      version,
      startedAt,
    });
    // Should not throw — catches and returns db:"down"
    await expect(getStatus()).resolves.toBeDefined();
    const result = await getStatus();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.db).toBe("down");
    }
  });
});
