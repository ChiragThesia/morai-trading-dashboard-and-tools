/**
 * makeStartReauth use-case tests (Phase 37, Plan 02, Task 2 — TDD RED phase).
 *
 * Behavior: makeStartReauth({ startReauth }) returns a use-case fn that, given an app, returns
 * exactly what the injected ForStartingReauth port returns — a fake port returning ok is
 * observable end to end; an err passes through unchanged.
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import { makeStartReauth } from "./startReauth.ts";
import type { ForStartingReauth } from "./ports.ts";

describe("makeStartReauth", () => {
  it("passes an ok Result from the injected port straight through", async () => {
    const fakePort: ForStartingReauth = async (app) => {
      expect(app).toBe("trader");
      return ok({ authUrl: "https://api.schwabapi.com/oauth/authorize?client_id=fake" });
    };
    const startReauth = makeStartReauth({ startReauth: fakePort });

    const result = await startReauth("trader");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.value.authUrl).toBe("https://api.schwabapi.com/oauth/authorize?client_id=fake");
  });

  it("passes an err Result from the injected port straight through", async () => {
    const fakePort: ForStartingReauth = async () =>
      err({ kind: "upstream-error", message: "sidecar returned 503" });
    const startReauth = makeStartReauth({ startReauth: fakePort });

    const result = await startReauth("market");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err result");
    expect(result.error.kind).toBe("upstream-error");
  });
});
