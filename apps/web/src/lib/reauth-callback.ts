/**
 * reauth-callback — captures + strips the Schwab OAuth `?code=&state=` redirect params.
 *
 * The SPA lands at https://morai.wtf/?code=...&state=... after the operator authorizes with
 * Schwab. `captureAndStripReauthRedirect()` runs at module scope in main.ts, before React
 * renders, so the sensitive query string is stripped before any component ever reads
 * `window.location` — and it sidesteps a React StrictMode double-invoke (RESEARCH Pitfall 5)
 * because it isn't called from inside a component in the first place.
 *
 * `consumeCapturedRedirect()` is the wizard's one-shot read of the stashed href: the module
 * variable is cleared on first read, so even if the wizard's own mount effect is double-invoked
 * under StrictMode, only the first invocation observes a non-null value.
 *
 * LAW (UI-SPEC + CONTEXT, T-37-02): the code/state/redirect URL is never logged anywhere here.
 */

let capturedRedirect: string | null = null;

/** Pure: returns `href` when both `code` and `state` query params are present, else null. */
export function parseReauthRedirect(href: string): string | null {
  const url = new URL(href);
  const hasCode = url.searchParams.has("code");
  const hasState = url.searchParams.has("state");
  return hasCode && hasState ? href : null;
}

/**
 * Reads window.location.href; on a match, strips the query via history.replaceState (strip
 * BEFORE returning) and stashes the captured href for one later `consumeCapturedRedirect()`
 * call. Returns null (and touches nothing) when there's no code/state to capture.
 */
export function captureAndStripReauthRedirect(): string | null {
  const href = window.location.href;
  const matched = parseReauthRedirect(href);
  if (matched === null) return null;

  window.history.replaceState({}, "", "/");
  capturedRedirect = matched;
  return matched;
}

/** One-shot read: returns the stashed redirect href (if any) and clears it. */
export function consumeCapturedRedirect(): string | null {
  const redirect = capturedRedirect;
  capturedRedirect = null;
  return redirect;
}
