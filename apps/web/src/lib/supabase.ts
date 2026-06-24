import { createClient } from "@supabase/supabase-js";

// Supabase Auth client singleton — SPA (Vite), not SSR.
// Uses localStorage session by default (no cookie coordination needed).
// RESEARCH Pattern 5: use @supabase/supabase-js createClient, not @supabase/ssr.
// The `as string` casts on import.meta.env.* are the ONLY permitted `as` in this file
// (Vite env types do not narrow to string; vite-env.d.ts declares them as string already,
// but exactOptionalPropertyTypes requires the cast for createClient's string params).
export const supabase = createClient(
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  import.meta.env.VITE_SUPABASE_URL as string,
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
);
