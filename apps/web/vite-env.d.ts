/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_API_BASE_URL: string;
  // Dev-only auto-login (import.meta.env.DEV gated; never present in prod).
  readonly VITE_DEV_AUTH_EMAIL?: string;
  readonly VITE_DEV_AUTH_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
