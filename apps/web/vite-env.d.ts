/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /**
   * Absent in the two same-origin setups (dev server, Vercel) — so it is genuinely
   * optional, and the compiler should say so. Read it through
   * `src/lib/api-base.ts`, never directly: typing it as a plain `string` is what let
   * `.replace()` on an undefined value reach CI.
   */
  readonly VITE_API_BASE_URL?: string;
  // Dev-only auto-login (import.meta.env.DEV gated; never present in prod).
  readonly VITE_DEV_AUTH_EMAIL?: string;
  readonly VITE_DEV_AUTH_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
