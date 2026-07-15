import { useState, useRef, useEffect } from "react";
import { supabase } from "../lib/supabase.ts";
import { Input } from "../components/ui/input.tsx";
import { Button, Panel } from "../components/system/index.tsx";

/**
 * Login — Supabase Auth login screen per the locked UI-SPEC interaction contract.
 *
 * Visual spec (09-UI-SPEC.md "Login screen"):
 * - Full viewport centered flex column, body gradient background
 * - Card: max-width 360px, Panel gradient token surface, border-radius 12px, padding 24px
 * - Brand: MOR**AI** logotype (violet "AI")
 * - Heading: "Sign in" (subhead token)
 * - Sub-heading: "Trading dashboard — access restricted to authorized users" (label token, dim)
 * - shadcn Input for email (auto-focus) and password
 * - Submit button: full-width violet, "Sign in" / "Signing in…" loading state
 * - Inline error (coral) below password: exact locked copy from UI-SPEC
 * - Enter in password field submits
 * - No signup/forgot links
 *
 * Copywriting (locked by UI-SPEC Copywriting Contract):
 * - Error: invalid credentials → "Invalid email or password."
 * - Error: network failure → "Could not reach the server. Check your connection."
 *
 * Security (T-09-04): no console.* of credentials.
 */
export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  // Auto-focus email field on mount (UI-SPEC: "email field auto-focused on mount")
  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  async function doSignIn() {
    setError(null);
    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (authError !== null) {
        // Map Supabase error codes to the locked UI-SPEC copy
        // "Invalid email or password." for credential failures
        // "Could not reach the server. Check your connection." for network/fetch failures
        const isNetworkError =
          authError.message.toLowerCase().includes("fetch") ||
          authError.message.toLowerCase().includes("network") ||
          authError.status === 0;
        setError(
          isNetworkError
            ? "Could not reach the server. Check your connection."
            : "Invalid email or password.",
        );
      }
      // On success: supabase-js fires onAuthStateChange → useAuthSession updates → App re-renders
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void doSignIn();
  }

  // Enter in password field submits — calls doSignIn directly (no form event needed)
  function handlePasswordKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      void doSignIn();
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "radial-gradient(1100px 560px at 80% -10%, #141b29 0%, rgba(10,14,20,0) 58%), #0a0e14",
        padding: "24px",
      }}
    >
      <Panel className="w-full max-w-[360px] rounded-xl p-6">
        {/* Brand logotype: MOR + AI (violet) — subhead token */}
        <div className="mb-5 font-display text-base leading-[1.1] font-bold text-txt">
          MOR<strong className="text-violet">AI</strong>
        </div>

        {/* Heading: "Sign in" — subhead token */}
        <h1 className="mb-1.5 font-display text-base leading-[1.1] font-bold text-txt">
          Sign in
        </h1>

        {/* Sub-heading: label token, dim color */}
        <p className="mb-5 font-mono text-[10px] leading-[1.4] text-dim">
          Trading dashboard — access restricted to authorized users
        </p>

        <form onSubmit={(e) => void handleSubmit(e)}>
          {/* Email field */}
          <div style={{ marginBottom: "12px" }}>
            <label
              htmlFor="login-email"
              className="mb-1 block font-mono text-[10px] font-normal text-muted-foreground"
            >
              Email
            </label>
            <Input
              id="login-email"
              ref={emailRef}
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              autoComplete="email"
              disabled={loading}
              style={{ width: "100%" }}
            />
          </div>

          {/* Password field */}
          <div style={{ marginBottom: "16px" }}>
            <label
              htmlFor="login-password"
              className="mb-1 block font-mono text-[10px] font-normal text-muted-foreground"
            >
              Password
            </label>
            <Input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
              onKeyDown={handlePasswordKeyDown}
              autoComplete="current-password"
              disabled={loading}
              style={{ width: "100%" }}
            />
          </div>

          {/* Inline error — coral, label token, locked copy */}
          {error !== null && (
            <p role="alert" className="mb-3 font-mono text-[10px] leading-[1.4] text-down">
              {error}
            </p>
          )}

          {/* Submit button — full-width violet */}
          <Button type="submit" variant="primary" size="sm" disabled={loading} className="w-full">
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        {/* No signup/forgot links — single-user closed system (UI-SPEC) */}
      </Panel>
    </div>
  );
}
