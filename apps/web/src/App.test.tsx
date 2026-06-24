/**
 * App auth gate tests — asserts the routing behavior between Login and the app shell.
 *
 * RED-first: written before App.tsx / useAuthSession.ts / Login.tsx exist.
 *
 * Requirements:
 *   - App renders <Login> when session is null (no auth)
 *   - App renders the authenticated shell when session exists
 *   - Auth gate shows blank splash while session is loading (undefined)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { QueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { App } from "./App.tsx";

// Mock supabase — the auth gate uses supabase.auth.getSession + onAuthStateChange
vi.mock("./lib/supabase.ts", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
    },
  },
}));

// Mock rpc setAuthToken — called on session changes
vi.mock("./lib/rpc.ts", () => ({
  setAuthToken: vi.fn(),
  apiFetch: vi.fn(),
  rpc: {},
}));

// Mock queryClient — App uses the singleton; we override clear() for test isolation
vi.mock("./lib/queryClient.ts", () => ({
  queryClient: {
    clear: vi.fn(),
  },
}));

// Mock useStatus — AuthExpiredBanner (mounted in the authenticated shell) calls it
vi.mock("./hooks/useStatus.ts", () => ({
  useStatus: vi.fn(() => ({ data: undefined, isPending: true })),
}));

import { supabase } from "./lib/supabase.ts";

const mockSupabase = vi.mocked(supabase);

// Minimal session fixture
function makeSession(): Session {
  return {
    access_token: "test-token-123",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "refresh-token",
    user: {
      id: "user-id-1",
      app_metadata: {},
      user_metadata: {},
      aud: "authenticated",
      created_at: new Date().toISOString(),
      email: "test@example.com",
      role: "authenticated",
      updated_at: new Date().toISOString(),
    },
  };
}

function renderApp() {
  // Fresh QueryClient per test to avoid cross-test cache pollution
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>,
  );
}

describe("App auth gate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: onAuthStateChange returns a subscription that does nothing
    mockSupabase.auth.onAuthStateChange.mockReturnValue({
      data: {
        subscription: {
          unsubscribe: vi.fn(),
          id: "sub-1",
          callback: vi.fn(),
          handleApiError: vi.fn(),
        },
      },
    });
  });

  it("renders the Login screen when there is no session (session === null)", async () => {
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    await act(async () => {
      renderApp();
    });

    // Login screen must render — look for the "Sign in" heading or the form
    expect(screen.getByRole("heading", { name: /Sign in/i })).toBeDefined();
  });

  it("renders the authenticated shell when a session exists (session !== null)", async () => {
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: makeSession() },
      error: null,
    });

    await act(async () => {
      renderApp();
    });

    // The authenticated app should render (not Login) — Login heading should NOT be present
    expect(screen.queryByRole("heading", { name: /Sign in/i })).toBeNull();
    // The shell placeholder should render with data-testid="app-shell"
    expect(screen.getByTestId("app-shell")).toBeDefined();
  });

  it("renders a blank loading splash while session is loading (session === undefined)", async () => {
    // getSession is pending — never resolves during this render
    mockSupabase.auth.getSession.mockReturnValue(new Promise(() => undefined));

    const { container } = renderApp();

    // During loading, the App renders nothing (null)
    expect(screen.queryByRole("heading", { name: /Sign in/i })).toBeNull();
    expect(screen.queryByTestId("app-shell")).toBeNull();
    // Container should be effectively empty (no visible content)
    expect(container.textContent).toBe("");
  });
});
