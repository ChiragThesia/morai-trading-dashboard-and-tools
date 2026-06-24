import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase.ts";
import { setAuthToken } from "../lib/rpc.ts";
import { queryClient } from "../lib/queryClient.ts";

/**
 * useAuthSession — wraps Supabase Auth session state + auth state change listener.
 *
 * Return values:
 *   - `undefined` — session is still loading (startup check in progress)
 *   - `null` — no session (signed out)
 *   - `Session` — authenticated session
 *
 * On every auth state change:
 *   - Calls `setAuthToken(session?.access_token ?? null)` to sync the RPC client header
 *   - Calls `queryClient.clear()` on null session (sign-out / 401 — clears stale authed data)
 *
 * Uses `getSession()` (localStorage read, no network) for startup — not `getUser()`.
 * supabase-js handles access_token refresh automatically on near-expiry.
 *
 * Security (T-09-04): session.access_token is never logged.
 */
export function useAuthSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    // Startup: read from localStorage (no network call — getSession vs getUser trade-off)
    void supabase.auth.getSession().then(({ data }) => {
      const s = data.session;
      setSession(s);
      setAuthToken(s?.access_token ?? null);
      if (s === null) {
        queryClient.clear();
      }
    });

    // Subscribe to auth state changes (sign-in, sign-out, token refresh)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setAuthToken(s?.access_token ?? null);
      if (s === null) {
        queryClient.clear();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return session;
}
