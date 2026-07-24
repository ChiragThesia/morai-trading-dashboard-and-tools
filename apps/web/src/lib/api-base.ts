/**
 * The API base URL, resolved once from the environment.
 *
 * `VITE_API_BASE_URL` is legitimately absent or empty in two supported setups — the dev
 * server and the Vercel deployment both talk to the same origin over a relative path — so
 * "missing" means "" here, never an error. It was previously read as
 * `import.meta.env.VITE_API_BASE_URL.replace(...)` at two call sites, which threw
 * "Cannot read properties of undefined" on any machine without a local `.env.local`.
 * `vite-env.d.ts` typed it as a non-optional `string`, so the compiler waved it through.
 */

/** Normalises a raw env value into a base with no trailing slash. Exported for testing. */
export function resolveApiBase(raw: string | undefined): string {
  return (raw ?? "").replace(/\/$/, "");
}

/** Same-origin ("") unless VITE_API_BASE_URL points somewhere else. Never undefined. */
export const API_BASE = resolveApiBase(import.meta.env.VITE_API_BASE_URL);
