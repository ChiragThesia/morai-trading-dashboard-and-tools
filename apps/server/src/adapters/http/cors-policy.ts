/**
 * Shared CORS policy for the API app.
 *
 * Single source of truth for the allowed cross-origin methods — imported by BOTH
 * the composition root (main.ts) and the auth-integration test app so the test
 * exercises the real policy instead of a hand-copied one (the copy drift is how a
 * missing PUT shipped: browser preflight from morai.wtf failed with
 * "Method PUT is not allowed by Access-Control-Allow-Methods" while the suite
 * stayed green against its own list).
 */
export const CORS_ALLOW_METHODS: string[] = ["GET", "POST", "PUT", "OPTIONS"];

export const CORS_ALLOW_HEADERS: string[] = ["Authorization", "Content-Type"];
