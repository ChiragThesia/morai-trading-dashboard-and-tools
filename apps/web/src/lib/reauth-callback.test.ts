/**
 * reauth-callback.test.ts — TDD suite for the boot-time OAuth callback capture/strip (37-06).
 *
 * Behaviors under test:
 *   1. parseReauthRedirect: href returned only when BOTH code and state are present.
 *   2. captureAndStripReauthRedirect: strips via history.replaceState BEFORE returning the
 *      captured href; no-ops (returns null, no replaceState call) when there's nothing to
 *      capture.
 *   3. consumeCapturedRedirect: one-shot read — returns the captured href once, then null.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseReauthRedirect,
  captureAndStripReauthRedirect,
  consumeCapturedRedirect,
} from "./reauth-callback.ts";

describe("parseReauthRedirect", () => {
  it("returns the href when both code and state are present", () => {
    const href = "https://morai.wtf/?code=abc123&state=xyz789";
    expect(parseReauthRedirect(href)).toBe(href);
  });

  it("returns null when code is missing", () => {
    expect(parseReauthRedirect("https://morai.wtf/?state=xyz789")).toBeNull();
  });

  it("returns null when state is missing", () => {
    expect(parseReauthRedirect("https://morai.wtf/?code=abc123")).toBeNull();
  });

  it("returns null when neither is present", () => {
    expect(parseReauthRedirect("https://morai.wtf/")).toBeNull();
  });
});

describe("captureAndStripReauthRedirect", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
    consumeCapturedRedirect(); // drain any stray captured state between tests
  });

  it("strips the URL via history.replaceState before returning the captured href", () => {
    window.history.replaceState({}, "", "/?code=abc123&state=xyz789");
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    const result = captureAndStripReauthRedirect();

    expect(replaceStateSpy).toHaveBeenCalledWith({}, "", "/");
    expect(result).not.toBeNull();
    expect(result).toContain("code=abc123");
    expect(result).toContain("state=xyz789");
  });

  it("returns null and does not call replaceState when there's no code/state", () => {
    window.history.replaceState({}, "", "/");
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    const result = captureAndStripReauthRedirect();

    expect(result).toBeNull();
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });
});

describe("consumeCapturedRedirect", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("returns the captured href once, then null on a second call", () => {
    window.history.replaceState({}, "", "/?code=abc123&state=xyz789");
    captureAndStripReauthRedirect();

    expect(consumeCapturedRedirect()).toContain("code=abc123");
    expect(consumeCapturedRedirect()).toBeNull();
  });

  it("returns null when nothing was captured", () => {
    expect(consumeCapturedRedirect()).toBeNull();
  });
});
