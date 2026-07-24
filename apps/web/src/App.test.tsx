/**
 * App auth gate tests — asserts the routing behavior between Login and the app shell.
 *
 * Tests the three auth gate states via useAuthSession mock (deterministic, timing-independent):
 *   - session === null  → renders <Login>
 *   - session exists   → renders authenticated shell
 *   - session === undefined → blank loading splash (null)
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import React from "react";
import { App } from "./App.tsx";

// Mock uplot-react + CSS — Analyzer and Positions screens use uPlot; matchMedia is not
// available in jsdom so we stub the module at the top level here.
vi.mock("uplot-react", () => ({
  default: (): React.ReactElement => React.createElement("div", { "data-testid": "uplot-mock" }),
}));

vi.mock("uplot/dist/uPlot.min.css", () => ({}));

// Mock echarts-for-react — canvas init fails under jsdom
vi.mock("echarts-for-react", () => ({
  default: (): React.ReactElement => React.createElement("div", { "data-testid": "echarts-stub" }),
}));

// Mock visx — SVG APIs not available in jsdom
vi.mock("@visx/shape", () => ({
  LinePath: (): React.ReactElement => React.createElement("g"),
  AreaClosed: (): React.ReactElement => React.createElement("g"),
}));

vi.mock("@visx/gradient", () => ({
  LinearGradient: (): React.ReactElement => React.createElement("defs"),
}));

vi.mock("@visx/group", () => ({
  Group: ({ children }: { children?: React.ReactNode }): React.ReactElement =>
    React.createElement("g", null, children),
}));

vi.mock("@visx/scale", () => ({ scaleLinear: () => (v: number) => v }));
vi.mock("@visx/curve", () => ({ curveMonotoneX: {} }));
vi.mock("@visx/event", () => ({ localPoint: () => null }));

// Mock data hooks — prevent real API calls from authenticated shell screens
vi.mock("./hooks/usePositions.ts", () => ({ usePositions: vi.fn(() => ({ data: undefined, isLoading: true, isError: false, error: null })) }));
vi.mock("./hooks/useGex.ts", () => ({ useGex: vi.fn(() => ({ data: undefined, isLoading: true, isError: false, error: null })) }));
vi.mock("./hooks/useMarketStatus.ts", () => ({ useMarketStatus: vi.fn(() => ({ data: undefined, isLoading: true })) }));
vi.mock("./hooks/useTradeHistory.ts", () => ({ useTradeHistory: vi.fn(() => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() })) }));

// Mock useAuthSession — controls the session state directly without supabase internals
vi.mock("./hooks/useAuthSession.ts", () => ({
  useAuthSession: vi.fn(),
}));

// Mock useStatus — AuthExpiredBanner (mounted in the authenticated shell) polls /api/status
vi.mock("./hooks/useStatus.ts", () => ({
  useStatus: vi.fn(() => ({ data: undefined, isPending: true })),
}));

// Mock supabase — Login.tsx calls signInWithPassword; prevent real network calls in tests
vi.mock("./lib/supabase.ts", () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  },
}));

// Mock rpc — prevent real API calls in tests
vi.mock("./lib/rpc.ts", () => ({
  setAuthToken: vi.fn(),
  apiFetch: vi.fn(),
  rpc: {},
}));

// Mock queryClient — prevent cross-test state pollution
vi.mock("./lib/queryClient.ts", () => ({
  queryClient: { clear: vi.fn() },
}));

import { useAuthSession } from "./hooks/useAuthSession.ts";

const mockUseAuthSession = vi.mocked(useAuthSession);

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
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>,
  );
}

describe("App auth gate", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the Login screen when there is no session (session === null)", () => {
    mockUseAuthSession.mockReturnValue(null);
    renderApp();
    // Login screen must show the "Sign in" heading
    expect(screen.getByRole("heading", { name: /Sign in/i })).toBeDefined();
  });

  it("renders the authenticated shell when a session exists (session !== null)", () => {
    mockUseAuthSession.mockReturnValue(makeSession());
    renderApp();
    // Login heading must NOT be present
    expect(screen.queryByRole("heading", { name: /Sign in/i })).toBeNull();
    // The authenticated shell placeholder must render
    expect(screen.getByTestId("app-shell")).toBeDefined();
  });

  it("renders a blank loading splash while session is loading (session === undefined)", () => {
    mockUseAuthSession.mockReturnValue(undefined);
    const { container } = renderApp();
    // Neither Login nor shell renders during loading
    expect(screen.queryByRole("heading", { name: /Sign in/i })).toBeNull();
    expect(screen.queryByTestId("app-shell")).toBeNull();
    // Container is empty during loading
    expect(container.textContent).toBe("");
  });
});
